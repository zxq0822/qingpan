"use client";

import { useMemo, useState } from "react";
import QRCode from "qrcode";
import { SUPABASE_BUCKET, supabase } from "@/lib/supabaseClient";

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

  const handleGenerate = async (useCustom: boolean) => {
    if (!file) {
      setStatus("Select a file first.");
      return;
    }
    if (!ensureEnvReady()) return;

    setIsUploading(true);
    setStatus(null);
    setDownloadUrl(null);
    setDownloadName(null);

    let nextCode = useCustom && customCode.trim() ? customCode.trim() : createRandomCode();
    nextCode = nextCode.toUpperCase();

    let attempts = 0;
    while (attempts < 5) {
      const available = await reserveCode(nextCode);
      if (available) break;
      if (useCustom) {
        setIsUploading(false);
        setStatus("This pickup code already exists.");
        return;
      }
      nextCode = createRandomCode();
      attempts += 1;
    }

    if (attempts === 5) {
      setIsUploading(false);
      setStatus("Please retry, code generation failed.");
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const storagePath = `${nextCode}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, file, {
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
        filename: file.name,
        size: file.size,
        content_type: file.type,
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
            <div className="flex items-start justify-between gap-6">
              <h2 className="font-[var(--font-space-grotesk)] text-2xl font-semibold">
                Upload
              </h2>
              <span className="rounded-full bg-accent px-4 py-1 text-xs font-semibold uppercase text-white">
                Live
              </span>
            </div>

            <div className="mt-8 flex flex-col gap-6">
              <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
                File
                <input
                  type="file"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm"
                />
                {fileMeta ? (
                  <span className="text-xs text-ink-muted">{fileMeta}</span>
                ) : null}
              </label>

              <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
                Custom pickup code (optional)
                <input
                  type="text"
                  value={customCode}
                  onChange={(event) => setCustomCode(event.target.value.toUpperCase())}
                  placeholder="e.g. QP8X7K"
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm uppercase tracking-widest"
                />
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => handleGenerate(false)}
                  disabled={isUploading}
                  className="rounded-full bg-foreground px-5 py-3 text-sm font-semibold uppercase tracking-widest text-background transition hover:translate-y-[-1px] disabled:opacity-60"
                >
                  {isUploading ? "Uploading..." : "Generate random"}
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerate(true)}
                  disabled={isUploading}
                  className="rounded-full border border-foreground/20 px-5 py-3 text-sm font-semibold uppercase tracking-widest text-foreground transition hover:border-foreground disabled:opacity-60"
                >
                  Use custom
                </button>
              </div>

              <div className="rounded-2xl border border-dashed border-black/15 bg-black/5 p-6">
                <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">
                  Pickup code
                </p>
                <p className="mt-2 font-[var(--font-space-grotesk)] text-3xl tracking-[0.2em]">
                  {generatedCode || "------"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-black/10 bg-white/80 p-6 backdrop-blur">
              <div className="flex items-center justify-between">
                <h3 className="font-[var(--font-space-grotesk)] text-xl font-semibold">
                  Pickup
                </h3>
                <div className="text-xs uppercase tracking-[0.3em] text-ink-muted">
                  QR
                </div>
              </div>
              <div className="mt-4 flex min-h-[200px] items-center justify-center rounded-2xl border border-black/10 bg-white">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Pickup QR" className="h-40 w-40" />
                ) : (
                  <p className="text-sm text-ink-muted">
                    {isGenerating ? "Generating..." : "No QR yet."}
                  </p>
                )}
              </div>
              <div className="mt-4 flex flex-col gap-3">
                <input
                  type="text"
                  value={lookupCode}
                  onChange={(event) => setLookupCode(event.target.value.toUpperCase())}
                  placeholder="Enter pickup code"
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm uppercase tracking-widest"
                />
                <button
                  type="button"
                  onClick={handleLookup}
                  disabled={isLookingUp}
                  className="rounded-full bg-accent px-5 py-3 text-sm font-semibold uppercase tracking-widest text-white transition hover:bg-accent-deep disabled:opacity-60"
                >
                  {isLookingUp ? "Searching..." : "Get file"}
                </button>
                {downloadUrl ? (
                  <a
                    href={downloadUrl}
                    className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-foreground"
                    download={downloadName ?? undefined}
                  >
                    Download {downloadName ?? "file"}
                  </a>
                ) : (
                  <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm">
                    Waiting for a valid pickup code.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {status ? (
          <div className="rounded-full border border-black/10 bg-white/80 px-6 py-3 text-sm text-foreground">
            {status}
          </div>
        ) : null}
      </main>
    </div>
  );
}
