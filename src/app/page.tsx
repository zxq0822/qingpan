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
  const [showUploadResult, setShowUploadResult] = useState(false);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [uploadLog, setUploadLog] = useState<string[]>([]);
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

  const pushLog = (message: string) => {
    setUploadLog((prev) => {
      const next = [...prev, message];
      return next.slice(-6);
    });
  };

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
      pushLog("缺少环境变量 NEXT_PUBLIC_SUPABASE_URL");
      return false;
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setStatus("缺少环境变量 NEXT_PUBLIC_SUPABASE_ANON_KEY。");
      pushLog("缺少环境变量 NEXT_PUBLIC_SUPABASE_ANON_KEY");
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
    pushLog(`选择文件：${nextFile.name}`);
    if (!ensureEnvReady()) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus("缺少 Supabase 配置。");
      pushLog("缺少 Supabase 配置");
      return;
    }

    setIsUploading(true);
    setStatus("上传中...");
    pushLog("准备上传");
    setDownloadUrl(null);
    setDownloadName(null);
    setQrDataUrl(null);
    setGeneratedCode("");
    setUploadedPath(null);
    setUploadedFileName(null);
    setExpiresAt(null);
    setShowUploadResult(false);

    try {
      let nextCode = createRandomCode().toUpperCase();
      let attempts = 0;
      while (attempts < 5) {
        const available = await reserveCode(nextCode);
        if (available) break;
        nextCode = createRandomCode();
        attempts += 1;
      }

      if (attempts === 5) {
        setStatus("生成取件码失败，请重试。");
        return;
      }

      const safeName = sanitizeFileName(nextFile.name);
      const storagePath = `${nextCode}/${Date.now()}_${safeName}`;
      const expiresAt = buildExpiresAt(expiryOption);

      pushLog("开始上传到存储桶");
      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(storagePath, nextFile, {
          upsert: false,
          cacheControl: "3600",
        });

      if (uploadError) {
        setStatus(`上传失败：${uploadError.message}`);
        pushLog(`上传失败：${uploadError.message}`);
        return;
      }

      pushLog("上传完成，写入取件码");
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
        setStatus(`保存取件码失败：${insertError?.message ?? "未知错误"}`);
        pushLog(`保存取件码失败：${insertError?.message ?? "未知错误"}`);
        return;
      }

      setGeneratedCode(nextCode);
      setUploadedPath(storagePath);
      setUploadedFileName(nextFile.name);
      setExpiresAt(expiresAt);
      setStatus("取件码已生成。");
      pushLog(`取件码已生成：${nextCode}`);
      setShowUploadResult(true);
      await buildQr(nextCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatus(`上传异常：${message}`);
      pushLog(`上传异常：${message}`);
    } finally {
      setIsUploading(false);
    }
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

  const resetUploadPanel = () => {
    setGeneratedCode("");
    setUploadedPath(null);
    setUploadedFileName(null);
    setQrDataUrl(null);
    setExpiresAt(null);
    setShowUploadResult(false);
    setStatus(null);
    setUploadLog([]);
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
          <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-[0_20px_60px_-45px_rgba(20,17,15,0.5)] sm:bg-white/80 sm:p-8 sm:backdrop-blur qp-card">
            {showUploadResult && generatedCode ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="text-xs uppercase tracking-[0.3em] text-ink-muted">
                  取件码
                </div>
                <div className="font-[var(--font-display)] text-2xl tracking-[0.2em]">
                  {generatedCode}
                </div>
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="取件二维码" className="h-32 w-32" />
                ) : null}
                <div className="text-xs text-ink-muted">
                  到期时间：{formatExpiryText(expiresAt, expiryOption)}
                </div>
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:gap-3">
                  <button
                    type="button"
                    onClick={refreshCode}
                    disabled={isRefreshing}
                    className="flex-1 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] disabled:opacity-60"
                  >
                    {isRefreshing ? "刷新中..." : "刷新取件码"}
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
                    className="flex-1 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em]"
                  >
                    复制取件码
                  </button>
                </div>
                <div className="flex w-full flex-col gap-2">
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
                </div>
                <button
                  type="button"
                  onClick={resetUploadPanel}
                  className="mt-1 rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                >
                  继续上传
                </button>
              </div>
            ) : (
              <div
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
                className={`flex min-h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 text-center text-sm transition sm:min-h-[240px] sm:px-6 qp-drop ${isDragging
                  ? "border-foreground bg-black/5"
                  : "border-black/10 bg-white"
                  }`}
              >
                <div className="text-sm font-semibold text-foreground sm:text-base sm:uppercase sm:tracking-[0.3em] qp-drop-title">
                  上传文件
                </div>
                <div className="mt-2 text-xs text-foreground/70 sm:mt-3 sm:text-sm qp-drop-hint">
                  点击下方选择文件，或拖拽到此处上传。
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={(event) => {
                    const picked = event.currentTarget.files?.[0] ?? null;
                    setFile(picked);
                    if (picked) {
                      pushLog(`已选择文件：${picked.name}`);
                      void uploadFile(picked);
                    }
                  }}
                  onInput={(event) => {
                    const picked = event.currentTarget.files?.[0] ?? null;
                    if (picked) {
                      pushLog(`触发输入：${picked.name}`);
                    }
                  }}
                  className="mt-3 w-full max-w-xs rounded-xl border border-black/10 bg-white px-3 py-2 text-xs"
                />
                {isUploading ? (
                  <div className="mt-3 text-[11px] text-foreground/60 sm:mt-4 sm:text-xs sm:uppercase sm:tracking-[0.3em] qp-drop-meta">
                    上传中...
                  </div>
                ) : null}
                {fileMeta ? (
                  <div className="mt-3 text-[11px] text-foreground/60 sm:mt-4 sm:text-xs qp-drop-meta">
                    {fileMeta}
                  </div>
                ) : null}
              </div>
            )}
            {!showUploadResult ? (
              <div className="mt-4 rounded-2xl border border-black/10 bg-white px-3 py-2 text-[11px] text-foreground/70">
                <div className="text-[10px] uppercase tracking-[0.2em] text-ink-muted">
                  上传日志
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {uploadLog.length === 0 ? (
                    <span>等待选择文件...</span>
                  ) : (
                    uploadLog.map((item, index) => (
                      <span key={`${item}-${index}`}>{item}</span>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-black/10 bg-white p-5 sm:bg-white/80 sm:p-8 sm:backdrop-blur qp-card">
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center sm:gap-4 qp-pickup">
              <input
                type="text"
                value={lookupCode}
                onChange={(event) => setLookupCode(event.target.value.toUpperCase())}
                placeholder="输入取件码"
                className="w-full max-w-sm rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm tracking-[0.15em] sm:uppercase sm:tracking-widest qp-input"
              />
              <div className="flex w-full max-w-sm flex-col gap-2 sm:flex-row sm:gap-3">
                <button
                  type="button"
                  onClick={handleLookup}
                  disabled={isLookingUp}
                  className="flex-1 rounded-full bg-foreground px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-background transition hover:translate-y-[-1px] disabled:opacity-60 sm:tracking-widest qp-btn"
                >
                  {isLookingUp ? "查询中..." : "取件"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsScanOpen(true)}
                  className="flex-1 rounded-full border border-foreground/20 px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground sm:tracking-widest qp-btn qp-btn-outline"
                >
                  扫码
                </button>
              </div>
            </div>
          </div>
        </section>

        {downloadUrl ? (
          <div className="rounded-3xl border border-black/10 bg-white p-5 text-sm text-foreground shadow-[0_20px_60px_-45px_rgba(20,17,15,0.5)] sm:bg-white/80 sm:p-6 sm:backdrop-blur">
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
