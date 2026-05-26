"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { SUPABASE_BUCKET, getSupabaseClient } from "@/lib/supabaseClient";

function createRandomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [generatedCode, setGeneratedCode] = useState("");
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lookupCode, setLookupCode] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<
    "image" | "pdf" | "video" | "audio" | "other" | null
  >(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [expiryOption, setExpiryOption] = useState<"24h" | "7d" | "forever">(
    "24h"
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const fileMeta = useMemo(() => {
    if (!file) return null;
    const sizeMb = file.size / (1024 * 1024);
    return `${file.name} · ${sizeMb.toFixed(2)} MB`;
  }, [file]);

  const buildQr = async (code: string) => {
    setIsGenerating(true);
    try {
      const dataUrl = await QRCode.toDataURL(code, {
        margin: 1,
        width: 240,
        color: {
          dark: "#14110f",
          light: "#f5f2ea",
        },
      });
      setQrDataUrl(dataUrl);
    } catch {
      setQrDataUrl(null);
      setStatus("二维码生成失败，请重试。");
    } finally {
      setIsGenerating(false);
    }
  };

  const ensureEnvReady = () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      setStatus("缺少环境变量 NEXT_PUBLIC_SUPABASE_URL。");
      return false;
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setStatus("缺少环境变量 NEXT_PUBLIC_SUPABASE_ANON_KEY。");
      return false;
    }
    return true;
  };

  const reserveCode = async (desiredCode: string) => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      throw new Error("缺少 Supabase 配置。");
    }

    const { data, error } = await supabase
      .from("qingpan_files")
      .select("code")
      .eq("code", desiredCode)
      .maybeSingle();

    if (error) {
      throw new Error("取件码校验失败。");
    }
    return !data;
  };

  const resolvePreviewKind = (name: string, type?: string | null) => {
    const lowerName = name.toLowerCase();
    if (type?.startsWith("image/")) return "image";
    if (type?.startsWith("video/")) return "video";
    if (type?.startsWith("audio/")) return "audio";
    if (type === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
    if (
      lowerName.endsWith(".png") ||
      lowerName.endsWith(".jpg") ||
      lowerName.endsWith(".jpeg") ||
      lowerName.endsWith(".webp") ||
      lowerName.endsWith(".gif")
    ) {
      return "image";
    }
    if (
      lowerName.endsWith(".mp4") ||
      lowerName.endsWith(".webm") ||
      lowerName.endsWith(".mov")
    ) {
      return "video";
    }
    if (lowerName.endsWith(".mp3") || lowerName.endsWith(".wav")) {
      return "audio";
    }
    return "other";
  };

  const sanitizeFileName = (name: string) =>
    name.replace(/[^a-zA-Z0-9_.-]/g, "_");

  const buildExpiresAt = (option: "24h" | "7d" | "forever") => {
    if (option === "forever") return null;
    const now = Date.now();
    const delta = option === "24h" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    return new Date(now + delta).toISOString();
  };

  const formatExpiryText = (value: string | null, option: "24h" | "7d" | "forever") => {
    if (option === "forever") return "永久";
    if (!value) return "未知";
    return new Date(value).toLocaleString();
  };

  const uploadFile = async (nextFile: File) => {
    if (!ensureEnvReady()) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus("缺少 Supabase 配置。");
      return;
    }

    setIsUploading(true);
    setStatus(null);
    setDownloadUrl(null);
    setDownloadName(null);
    setQrDataUrl(null);
    setGeneratedCode("");
    setUploadedPath(null);
    setUploadedFileName(null);
    setExpiresAt(null);
    setIsModalOpen(false);

    let nextCode = createRandomCode().toUpperCase();
    let attempts = 0;
    while (attempts < 5) {
      const available = await reserveCode(nextCode);
      if (available) break;
      nextCode = createRandomCode();
      attempts += 1;
    }

    if (attempts === 5) {
      setIsUploading(false);
      setStatus("生成取件码失败，请重试。");
      return;
    }

    const safeName = sanitizeFileName(nextFile.name);
    const storagePath = `${nextCode}/${Date.now()}_${safeName}`;
    const expiresAt = buildExpiresAt(expiryOption);

    const { error: uploadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, nextFile, {
        upsert: false,
      });

    if (uploadError) {
      setIsUploading(false);
      setStatus("上传失败，请检查存储桶策略。");
      return;
    }

    const { data: insertData, error: insertError } = await supabase
      .from("qingpan_files")
      .insert({
        code: nextCode,
        path: storagePath,
        filename: nextFile.name,
        size: nextFile.size,
        content_type: nextFile.type,
        expires_at: expiresAt,
      })
      .select("code")
      .single();

    if (insertError || !insertData) {
      setIsUploading(false);
      setStatus("保存取件码失败。");
      return;
    }

    setGeneratedCode(nextCode);
    setUploadedPath(storagePath);
    setUploadedFileName(nextFile.name);
    setExpiresAt(expiresAt);
    setStatus("取件码已生成。");
    await buildQr(nextCode);
    setIsModalOpen(true);
    setIsUploading(false);
  };

  const updateExpiry = async (option: "24h" | "7d" | "forever") => {
    setExpiryOption(option);
    if (!generatedCode) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus("缺少 Supabase 配置。");
      return;
    }

    const expiresAt = buildExpiresAt(option);
    const { error } = await supabase
      .from("qingpan_files")
      .update({ expires_at: expiresAt })
      .eq("code", generatedCode);

    if (error) {
      setStatus("更新有效期失败。");
      return;
    }

    setExpiresAt(expiresAt);
    setStatus("有效期已更新。");
  };

  const refreshCode = async () => {
    if (!uploadedPath || !uploadedFileName || !generatedCode) {
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus("缺少 Supabase 配置。");
      return;
    }

    setIsRefreshing(true);
    setStatus(null);

    let nextCode = createRandomCode().toUpperCase();
    let attempts = 0;
    while (attempts < 5) {
      const available = await reserveCode(nextCode);
      if (available) break;
      nextCode = createRandomCode();
      attempts += 1;
    }

    if (attempts === 5) {
      setIsRefreshing(false);
      setStatus("刷新取件码失败，请重试。");
      return;
    }

    const safeName = sanitizeFileName(uploadedFileName);
    const nextPath = `${nextCode}/${Date.now()}_${safeName}`;
    const { error: moveError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .move(uploadedPath, nextPath);

    if (moveError) {
      setIsRefreshing(false);
      setStatus(`刷新失败：${moveError.message}`);
      return;
    }

    const expiresAt = buildExpiresAt(expiryOption);
    const { error: updateError } = await supabase
      .from("qingpan_files")
      .update({ code: nextCode, path: nextPath, expires_at: expiresAt })
      .eq("code", generatedCode);

    if (updateError) {
      setIsRefreshing(false);
      setStatus("更新取件码失败。");
      return;
    }

    setGeneratedCode(nextCode);
    setUploadedPath(nextPath);
    setExpiresAt(expiresAt);
    await buildQr(nextCode);
    setStatus("取件码已刷新。");
    setIsRefreshing(false);
  };

  const stopScan = () => {
    if (scanFrameRef.current !== null) {
      cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (!isScanOpen) {
      stopScan();
      return;
    }

    const startScan = async () => {
      setScanError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        streamRef.current = stream;

        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const scanLoop = () => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas) {
            scanFrameRef.current = requestAnimationFrame(scanLoop);
            return;
          }

          const width = video.videoWidth;
          const height = video.videoHeight;
          if (!width || !height) {
            scanFrameRef.current = requestAnimationFrame(scanLoop);
            return;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            scanFrameRef.current = requestAnimationFrame(scanLoop);
            return;
          }

          ctx.drawImage(video, 0, 0, width, height);
          const image = ctx.getImageData(0, 0, width, height);
          const code = jsQR(image.data, width, height);

          if (code?.data) {
            setLookupCode(code.data.trim().toUpperCase());
            setStatus("已识别二维码。");
            setIsScanOpen(false);
            return;
          }

          scanFrameRef.current = requestAnimationFrame(scanLoop);
        };

        scanFrameRef.current = requestAnimationFrame(scanLoop);
      } catch {
        setScanError("无法打开摄像头，请检查权限。");
      }
    };

    void startScan();

    return () => {
      stopScan();
    };
  }, [isScanOpen]);

  const handleLookup = async () => {
    if (!lookupCode.trim()) {
      setStatus("请输入取件码。");
      return;
    }
    if (!ensureEnvReady()) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus("缺少 Supabase 配置。");
      return;
    }

    setIsLookingUp(true);
    setStatus(null);
    setDownloadUrl(null);
    setDownloadName(null);
    setPreviewKind(null);

    const { data, error } = await supabase
      .from("qingpan_files")
      .select("path, filename, content_type, expires_at")
      .eq("code", lookupCode.trim().toUpperCase())
      .maybeSingle();

    if (error || !data) {
      setIsLookingUp(false);
      setStatus("未找到对应文件。");
      return;
    }

    if (data.expires_at) {
      const expiresAt = new Date(data.expires_at).getTime();
      if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
        await supabase.from("qingpan_files").delete().eq("code", lookupCode.trim().toUpperCase());
        await supabase.storage.from(SUPABASE_BUCKET).remove([data.path]);
        setIsLookingUp(false);
        setStatus("取件码已过期，文件已删除。");
        return;
      }
    }

    const { data: publicData } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(data.path);

    if (!publicData.publicUrl) {
      setIsLookingUp(false);
      setStatus("生成下载链接失败。");
      return;
    }

    setDownloadUrl(publicData.publicUrl);
    setDownloadName(data.filename);
    setPreviewKind(resolvePreviewKind(data.filename, data.content_type));
    setStatus("文件已就绪，可下载。");
    setIsLookingUp(false);
  };

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 sm:py-16">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 sm:gap-10">
        <header className="flex flex-col gap-2 sm:gap-3">
          <h1 className="font-[var(--font-display)] text-3xl font-semibold tracking-[0.12em] text-foreground sm:text-5xl sm:tracking-[0.2em]">
            QingPan
          </h1>
        </header>

        <section className="grid gap-4 sm:gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-black/10 bg-white/80 p-5 shadow-[0_20px_60px_-45px_rgba(20,17,15,0.5)] backdrop-blur sm:p-8">
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const dropped = event.dataTransfer.files?.[0];
                if (dropped) {
                  setFile(dropped);
                  void uploadFile(dropped);
                }
              }}
              className={`flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 text-center text-sm transition sm:min-h-[240px] sm:px-6 ${isDragging
                ? "border-foreground bg-black/5"
                : "border-black/10 bg-white"
                }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(event) => {
                  const picked = event.target.files?.[0] ?? null;
                  setFile(picked);
                  if (picked) {
                    void uploadFile(picked);
                  }
                }}
              />
              <div className="text-sm font-semibold uppercase tracking-[0.25em] sm:text-base sm:tracking-[0.3em]">
                上传文件
              </div>
              <div className="mt-2 text-xs text-ink-muted sm:mt-3 sm:text-sm">
                点击选择文件，或拖拽到此处上传。
              </div>
              {isUploading ? (
                <div className="mt-3 text-[11px] uppercase tracking-[0.25em] text-ink-muted sm:mt-4 sm:text-xs sm:tracking-[0.3em]">
                  上传中...
                </div>
              ) : null}
              {fileMeta ? (
                <div className="mt-3 text-[11px] text-ink-muted sm:mt-4 sm:text-xs">
                  {fileMeta}
                </div>
              ) : null}
            </label>
          </div>

          <div className="rounded-3xl border border-black/10 bg-white/80 p-5 backdrop-blur sm:p-8">
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center sm:gap-4">
              <input
                type="text"
                value={lookupCode}
                onChange={(event) => setLookupCode(event.target.value.toUpperCase())}
                placeholder="输入取件码"
                className="w-full max-w-sm rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm uppercase tracking-[0.2em] sm:tracking-widest"
              />
              <div className="flex w-full max-w-sm flex-col gap-2 sm:flex-row sm:gap-3">
                <button
                  type="button"
                  onClick={handleLookup}
                  disabled={isLookingUp}
                  className="flex-1 rounded-full bg-foreground px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-background transition hover:translate-y-[-1px] disabled:opacity-60 sm:tracking-widest"
                >
                  {isLookingUp ? "查询中..." : "取件"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsScanOpen(true)}
                  className="flex-1 rounded-full border border-foreground/20 px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground sm:tracking-widest"
                >
                  扫码
                </button>
              </div>
            </div>
          </div>
        </section>

        {downloadUrl ? (
          <div className="rounded-3xl border border-black/10 bg-white/80 p-5 text-sm text-foreground shadow-[0_20px_60px_-45px_rgba(20,17,15,0.5)] backdrop-blur sm:p-6">
            <div className="flex flex-col gap-4">
              <div className="text-xs uppercase tracking-[0.3em] text-ink-muted">
                预览
              </div>
              {previewKind === "image" ? (
                <img
                  src={downloadUrl}
                  alt={downloadName ?? "预览"}
                  className="max-h-[420px] w-full rounded-2xl object-contain"
                />
              ) : null}
              {previewKind === "pdf" ? (
                <iframe
                  src={downloadUrl}
                  className="h-[420px] w-full rounded-2xl border border-black/10"
                  title={downloadName ?? "PDF"}
                />
              ) : null}
              {previewKind === "video" ? (
                <video
                  src={downloadUrl}
                  controls
                  className="max-h-[420px] w-full rounded-2xl"
                />
              ) : null}
              {previewKind === "audio" ? (
                <audio src={downloadUrl} controls className="w-full" />
              ) : null}
              {previewKind === "other" ? (
                <div className="rounded-2xl border border-dashed border-black/15 bg-white px-4 py-6 text-center text-xs text-ink-muted">
                  无法预览该格式，请直接下载文件。
                </div>
              ) : null}
              <a
                href={downloadUrl}
                className="rounded-full bg-foreground px-5 py-3 text-center text-sm font-semibold uppercase tracking-[0.2em] text-background transition hover:translate-y-[-1px] sm:tracking-widest"
                download={downloadName ?? undefined}
              >
                下载 {downloadName ?? "文件"}
              </a>
            </div>
          </div>
        ) : null}

        {isModalOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setIsModalOpen(false);
              }
            }}
          >
            <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-sm text-foreground shadow-lg sm:max-w-sm sm:p-6">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold sm:text-base">取件码</div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-full border border-black/10 px-3 py-1 text-xs"
                >
                  关闭
                </button>
              </div>
              <div className="mt-3 text-center font-[var(--font-display)] text-xl tracking-[0.2em] sm:mt-4 sm:text-2xl">
                {generatedCode}
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-3">
                <button
                  type="button"
                  onClick={refreshCode}
                  disabled={isRefreshing}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-xs font-semibold disabled:opacity-60"
                  aria-label="刷新取件码"
                  title="刷新取件码"
                >
                  <span className="sr-only">刷新取件码</span>
                  <svg
                    className={isRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    <path d="M21 3v6h-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(generatedCode);
                      setStatus("取件码已复制。");
                    } catch {
                      setStatus("复制失败，请手动复制。");
                    }
                  }}
                  className="flex-1 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] sm:tracking-widest"
                >
                  复制取件码
                </button>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <div className="text-[11px] uppercase tracking-[0.25em] text-ink-muted">
                  有效期
                </div>
                <select
                  value={expiryOption}
                  onChange={(event) =>
                    updateExpiry(event.target.value as "24h" | "7d" | "forever")
                  }
                  className="w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em]"
                >
                  <option value="24h">24小时</option>
                  <option value="7d">7天</option>
                  <option value="forever">永久</option>
                </select>
                <div className="text-xs text-ink-muted">
                  到期时间：{formatExpiryText(expiresAt, expiryOption)}
                </div>
              </div>
              {qrDataUrl ? (
                <div className="mt-4 flex justify-center">
                  <img src={qrDataUrl} alt="取件二维码" className="h-32 w-32 sm:h-40 sm:w-40" />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {isScanOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setIsScanOpen(false);
              }
            }}
          >
            <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-sm text-foreground shadow-lg sm:max-w-sm sm:p-6">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold sm:text-base">扫码取件</div>
                <button
                  type="button"
                  onClick={() => setIsScanOpen(false)}
                  className="rounded-full border border-black/10 px-3 py-1 text-xs"
                >
                  关闭
                </button>
              </div>
              <div className="mt-4 overflow-hidden rounded-2xl border border-black/10 bg-black/5">
                <video ref={videoRef} className="h-52 w-full object-cover sm:h-64" />
                <canvas ref={canvasRef} className="hidden" />
              </div>
              <div className="mt-3 text-xs text-ink-muted">
                {scanError ?? "请对准二维码，自动识别。"}
              </div>
            </div>
          </div>
        ) : null}

        {status ? (
          <div className="rounded-full border border-black/10 bg-white/80 px-6 py-3 text-sm text-foreground">
            {status}
          </div>
        ) : null}
      </main>
    </div>
  );
}
