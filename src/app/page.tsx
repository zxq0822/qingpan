"use client";

import { useMemo, useRef, useState } from "react";
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
  const [customCode, setCustomCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lookupCode, setLookupCode] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      setStatus("Failed to build QR. Try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const ensureEnvReady = () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      setStatus("Missing NEXT_PUBLIC_SUPABASE_URL.");
      return false;
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setStatus("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return false;
    }
    return true;
  };

  const reserveCode = async (desiredCode: string) => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      throw new Error("Missing Supabase configuration.");
    }

    const { data, error } = await supabase
      .from("qingpan_files")
      .select("code")
      .eq("code", desiredCode)
      .maybeSingle();

    if (error) {
      throw new Error("Failed to validate code.");
    }
    return !data;
  };

  const uploadFile = async (nextFile: File) => {
    if (!ensureEnvReady()) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus("Missing Supabase configuration.");
      return;
    }

    setIsUploading(true);
    setStatus(null);
    setDownloadUrl(null);
    setDownloadName(null);
    setQrDataUrl(null);
    setGeneratedCode("");

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
      setStatus("Please retry, code generation failed.");
      return;
    }

    const safeName = nextFile.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const storagePath = `${nextCode}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, nextFile, {
        upsert: false,
      });

    if (uploadError) {
      setIsUploading(false);
      setStatus("Upload failed. Check bucket policies.");
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
      })
      .select("code")
      .single();

    if (insertError || !insertData) {
      setIsUploading(false);
      setStatus("Failed to save pickup code.");
      return;
    }

    setGeneratedCode(nextCode);
    setStatus("Code ready. Share it to unlock the file.");
    await buildQr(nextCode);
    setIsUploading(false);
  };

  const handleLookup = async () => {
    if (!lookupCode.trim()) {
      setStatus("Enter a pickup code to continue.");
      return;
    }
    if (!ensureEnvReady()) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus("Missing Supabase configuration.");
      return;
    }

    setIsLookingUp(true);
    setStatus(null);
    setDownloadUrl(null);
    setDownloadName(null);

    const { data, error } = await supabase
      .from("qingpan_files")
      .select("path, filename")
      .eq("code", lookupCode.trim().toUpperCase())
      .maybeSingle();

    if (error || !data) {
      setIsLookingUp(false);
      setStatus("No match found.");
      return;
    }

    const { data: publicData } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(data.path);

    if (!publicData.publicUrl) {
      setIsLookingUp(false);
      setStatus("Failed to build download link.");
      return;
    }

    setDownloadUrl(publicData.publicUrl);
    setDownloadName(data.filename);
    setStatus("File ready to download.");
    setIsLookingUp(false);
  };

  return (
    <div className="min-h-screen px-6 py-16">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <header className="flex flex-col gap-3">
          <h1 className="font-[var(--font-space-grotesk)] text-5xl font-semibold uppercase tracking-[0.35em] text-foreground sm:text-6xl">
            QingPan
          </h1>
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-black/10 bg-white/80 p-8 shadow-[0_30px_80px_-50px_rgba(20,17,15,0.6)] backdrop-blur">
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
              className={`flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center text-sm transition ${isDragging
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
              <div className="text-base font-semibold uppercase tracking-[0.3em]">
                Upload
              </div>
              <div className="mt-3 text-ink-muted">
                Click to choose a file or drag it here.
              </div>
              {isUploading ? (
                <div className="mt-4 text-xs uppercase tracking-[0.3em] text-ink-muted">
                  Uploading...
                </div>
              ) : null}
              {fileMeta ? (
                <div className="mt-4 text-xs text-ink-muted">{fileMeta}</div>
              ) : null}
            </label>
          </div>

          <div className="rounded-3xl border border-black/10 bg-white/80 p-8 backdrop-blur">
            <div className="flex flex-col gap-4">
              <input
                type="text"
                value={lookupCode}
                onChange={(event) => setLookupCode(event.target.value.toUpperCase())}
                placeholder="Enter pickup code"
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm uppercase tracking-widest"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleLookup}
                  disabled={isLookingUp}
                  className="flex-1 rounded-full bg-foreground px-5 py-3 text-sm font-semibold uppercase tracking-widest text-background transition hover:translate-y-[-1px] disabled:opacity-60"
                >
                  {isLookingUp ? "Searching..." : "Get file"}
                </button>
                <button
                  type="button"
                  onClick={() => setStatus("Please scan with your phone camera.")}
                  className="flex-1 rounded-full border border-foreground/20 px-5 py-3 text-sm font-semibold uppercase tracking-widest text-foreground transition hover:border-foreground"
                >
                  Scan QR
                </button>
              </div>
              {downloadUrl ? (
                <a
                  href={downloadUrl}
                  className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-foreground"
                  download={downloadName ?? undefined}
                >
                  Download {downloadName ?? "file"}
                </a>
              ) : null}
            </div>
          </div>
        </section>

        {generatedCode ? (
          <div className="flex flex-col gap-4 rounded-3xl border border-black/10 bg-white/80 p-6 text-sm text-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.4em] text-ink-muted">
                Pickup code
              </div>
              <div className="font-[var(--font-space-grotesk)] text-2xl tracking-[0.2em]">
                {generatedCode}
              </div>
            </div>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Pickup QR" className="h-32 w-32" />
            ) : null}
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
