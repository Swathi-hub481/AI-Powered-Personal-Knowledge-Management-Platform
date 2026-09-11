"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileUp, Leaf, Loader2, X } from "lucide-react";

// These are shown in the UI; users pick one or more. They are merged with
const TOP_TAGS = [
  "Technology",
  "AI",
  "Research",
  "Education",
  "Agriculture",
  "Finance",
  "Health",
  "Environment",
  "Law",
  "Business",
  "Science",
  "History",
] as const;

const ACCEPTED = ".pdf,.html,.htm,.txt,.md,.csv,.json";

const UPLOAD_TYPES = [
  "PDF documents",
  "HTML pages",
  "Text & Markdown files",
  "CSV & JSON files",
];

// Accepted MIME types and extensions for validation on drop
const ACCEPTED_EXTS = new Set([".pdf", ".html", ".htm", ".txt", ".md", ".csv", ".json"]);
const ACCEPTED_MIME = new Set([
  "application/pdf",
  "text/html",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/octet-stream", // fallback for some .md files
]);

function isAccepted(f: File): boolean {
  const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
  return ACCEPTED_EXTS.has(ext) || ACCEPTED_MIME.has(f.type);
}

export default function DocumentsPage() {
  const [title, setTitle] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [extraTags, setExtraTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0); // track nested drag-enter/leave pairs
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const acceptFile = useCallback((f: File) => {
    if (!isAccepted(f)) {
      setError(`"${f.name}" is not a supported format. Please upload a PDF, HTML, TXT, MD, CSV, or JSON file.`);
      return;
    }
    setError(null);
    setMessage(null);
    setFile(f);
    // Pre-fill title from filename if empty
    setTitle((prev) => prev || f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) acceptFile(dropped);
  }, [acceptFile]);

  const submit = async () => {
    if (!file) { setError("Choose a file first."); return; }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // Merge UI-selected tags with any extra free-form tags
      const allTags = [
        ...selectedTags,
        ...extraTags.split(",").map((t) => t.trim()).filter(Boolean),
      ].join(",");

      const fd = new FormData();
      fd.append("file", file);
      if (title.trim()) fd.append("title", title.trim());
      if (allTags) fd.append("tags", allTags);

      const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          `Server returned an unexpected response (HTTP ${res.status}). ` +
          `Check that MongoDB is connected and the file is under 150 MB.`
        );
      }
      const json = (await res.json()) as {
        data?: { chunkCount?: number; noteId?: string };
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setMessage(
        `Indexed ${json.data?.chunkCount ?? 0} chunks into the knowledge base.` +
        (json.data?.noteId ? " A note was created — check the Notes section." : "") +
        " You can now ask the AI assistant questions from this document."
      );
      setFile(null);
      setTitle("");
      setSelectedTags(new Set());
      setExtraTags("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full bg-[#f5f7f2] p-4 transition-colors duration-200 dark:bg-[#0d1510] md:p-6">
      {/* Outer wrapper with warm parchment feel */}
      <div className="mx-auto w-full max-w-2xl">

        {/* â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="mb-6 flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#d4e8d0] text-[#3a6b45] dark:bg-[#1e3a28] dark:text-[#6bbf7e]">
            <Leaf className="size-4.5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#2c4a35] dark:text-[#c8e6cb] md:text-3xl">
              Knowledge Ingest
            </h1>
            <p className="mt-0.5 text-sm text-[#4a6b52] dark:text-[#7aab82]">
              Upload a document and it will be extracted, summarised, and woven into your knowledge base.
            </p>
          </div>
        </div>

        {/* â”€â”€ Main card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="overflow-hidden rounded-2xl border border-[#cde0c9] bg-white shadow-sm dark:border-[#2a4030] dark:bg-[#111d14]">

          {/* Subtle top stripe */}
          <div className="h-1 bg-gradient-to-r from-[#7bbf8a] via-[#a8d5b0] to-[#c8e6cb]" />

          <div className="space-y-6 p-6 md:p-8">

            {/* â”€â”€ Accepted formats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div>
              <p className="mb-2.5 text-[0.7rem] font-semibold uppercase tracking-widest text-[#5a8a63] dark:text-[#6bbf7e]">
                Accepted formats
              </p>
              <div className="flex flex-wrap gap-2">
                {UPLOAD_TYPES.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-[#cde0c9] bg-[#f0f7ee] px-3 py-1 text-xs text-[#3a6b45] dark:border-[#2a4030] dark:bg-[#1a2e1e] dark:text-[#90c898]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div className="border-t border-[#e6f0e4] dark:border-[#1e3020]" />

            {/* â”€â”€ Title â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#4a6b52] dark:text-[#7aab82]">
                Title <span className="text-[#8ab490] dark:text-[#4a7054]">(optional)</span>
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q4 competitor analysis"
                className="rounded-xl border-[#cde0c9] bg-[#f7fbf6] text-sm focus-visible:ring-[#7bbf8a] dark:border-[#2a4030] dark:bg-[#0d1a10]"
              />
            </div>

            {/* â”€â”€ Topic tags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div>
              <label className="mb-2 block text-xs font-medium text-[#4a6b52] dark:text-[#7aab82]">
                Topic <span className="text-[#8ab490] dark:text-[#4a7054]">(select all that apply)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {TOP_TAGS.map((tag) => {
                  const active = selectedTags.has(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150 ${
                        active
                          ? "border-[#4a9456] bg-[#4a9456] text-white shadow-sm dark:border-[#5aaa66] dark:bg-[#5aaa66]"
                          : "border-[#cde0c9] bg-[#f0f7ee] text-[#3a6b45] hover:border-[#8ac496] hover:bg-[#e4f3e0] dark:border-[#2a4030] dark:bg-[#1a2e1e] dark:text-[#90c898] dark:hover:bg-[#223528]"
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
              {/* Free-form additional tags */}
              <Input
                value={extraTags}
                onChange={(e) => setExtraTags(e.target.value)}
                placeholder="Any other tags, comma-separated…"
                className="mt-2 rounded-xl border-[#cde0c9] bg-[#f7fbf6] text-xs focus-visible:ring-[#7bbf8a] dark:border-[#2a4030] dark:bg-[#0d1a10]"
              />
            </div>

            {/* â”€â”€ File drop zone â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#4a6b52] dark:text-[#7aab82]">
                File
              </label>

              {/* Drop target — also acts as click-to-browse label */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Drop a file here or click to browse"
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
                className={`relative flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[#4a9456] ${
                  dragOver
                    ? "scale-[1.01] border-[#4a9456] bg-[#e4f3e0] shadow-md dark:border-[#5aaa66] dark:bg-[#1e3522]"
                    : file
                      ? "border-[#4a9456] bg-[#eef6ec] dark:border-[#5aaa66] dark:bg-[#1a2e1e]"
                      : "border-[#cde0c9] bg-[#f7fbf6] hover:border-[#8ac496] hover:bg-[#f0f7ee] dark:border-[#2a4030] dark:bg-[#0d1a10] dark:hover:bg-[#131f15]"
                }`}
              >
                {dragOver ? (
                  <>
                    <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[#4a9456]/15 dark:bg-[#5aaa66]/20">
                      <FileUp className="size-5 text-[#4a9456] dark:text-[#5aaa66]" />
                    </div>
                    <p className="text-sm font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">
                      Release to add file
                    </p>
                  </>
                ) : file ? (
                  <>
                    <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[#4a9456]/10 dark:bg-[#5aaa66]/15">
                      <FileUp className="size-5 text-[#4a9456] dark:text-[#5aaa66]" />
                    </div>
                    <p className="max-w-[260px] truncate text-sm font-medium text-[#2c4a35] dark:text-[#c8e6cb]">
                      {file.name}
                    </p>
                    <p className="mt-0.5 text-xs text-[#5a8a63] dark:text-[#6bbf7e]">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    <p className="mt-1 text-[0.7rem] text-[#8ab490] dark:text-[#4a7054]">
                      Click to replace or drop a new file
                    </p>
                    {/* Clear button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                        setMessage(null);
                        setError(null);
                        if (inputRef.current) inputRef.current.value = "";
                      }}
                      className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full text-[#8ab490] transition-colors hover:bg-[#cde0c9] hover:text-[#2c4a35] dark:text-[#4a7054] dark:hover:bg-[#2a4030] dark:hover:text-[#c8e6cb]"
                      aria-label="Remove file"
                    >
                      <X className="size-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-[#e4f3e0] dark:bg-[#1a2e1e]">
                      <FileUp className="size-5 text-[#6aaa76] dark:text-[#5a9064]" />
                    </div>
                    <p className="text-sm font-medium text-[#3a6b45] dark:text-[#90c898]">
                      Drag & drop a file here
                    </p>
                    <p className="mt-0.5 text-xs text-[#6a9470] dark:text-[#4a7054]">
                      or <span className="underline underline-offset-2">click to browse</span>
                    </p>
                    <p className="mt-2 text-[0.68rem] text-[#8ab490] dark:text-[#3d6045]">
                      PDF Â· HTML Â· TXT Â· MD Â· CSV Â· JSON — up to 150 MB
                    </p>
                  </>
                )}

                {/* Hidden file input */}
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED}
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) acceptFile(f);
                  }}
                />
              </div>
            </div>

            {/* â”€â”€ Submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="space-y-3">
              <Button
                type="button"
                disabled={busy || !file}
                onClick={() => void submit()}
                className="w-full rounded-full bg-[#4a9456] py-2.5 text-sm font-semibold text-white hover:bg-[#3d7d49] disabled:opacity-50 dark:bg-[#5aaa66] dark:hover:bg-[#4d9459]"
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Ingesting…
                  </>
                ) : (
                  <>
                    <FileUp className="mr-2 size-4" />
                    Ingest & index
                  </>
                )}
              </Button>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
                  {error}
                </div>
              )}
              {message && (
                <div className="rounded-xl border border-[#cde0c9] bg-[#f0f7ee] px-4 py-2.5 text-sm text-[#2c4a35] dark:border-[#2a4030] dark:bg-[#1a2e1e] dark:text-[#c8e6cb]">
                  {message}
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
