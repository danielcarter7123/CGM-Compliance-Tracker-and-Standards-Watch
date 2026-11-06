// Evidence on tasks and client tasks (docs/EVIDENCE.md). Shared by the browser upload box and the server.
// The database decides who may add, see and remove evidence (0005: follows the task; soft remove only).

/** File types the app accepts (docs/EVIDENCE.md "Large and sensitive files"). */
export const EVIDENCE_TYPES = [
  "pdf", "doc", "docx", "xls", "xlsx", "xlsm", "csv", "ppt", "pptx", "txt", "rtf", "xml", "json",
  "png", "jpg", "jpeg", "gif", "tif", "tiff", "bmp", "heic", "msg", "eml", "vsd", "vsdx", "zip", "7z",
] as const;
/** The storage limit (supabase/config.toml file_size_limit; raise both together). */
export const EVIDENCE_MAX_BYTES = 50 * 1024 * 1024;

export const extOf = (name: string) => (name.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
export const allowedType = (name: string) => (EVIDENCE_TYPES as readonly string[]).includes(extOf(name));

/** A storage-safe file name: letters, digits, dot, dash and underscore; at most 120 characters, extension kept. */
export function safeFileName(name: string) {
  const ext = extOf(name);
  const base = name.replace(/\.[A-Za-z0-9]+$/, "").normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^[_.]+|[_.]+$/g, "");
  return `${(base || "file").slice(0, 110)}${ext ? `.${ext}` : ""}`;
}

/** "<company>/<task or ct-<client task>>/<uuid>-<file name>" (the storage policies require the company folder first). */
export const evidencePath = (company: string, target: { task?: string; ctask?: string }, uuid: string, name: string) =>
  `${company}/${target.task || `ct-${target.ctask}`}/${uuid}-${safeFileName(name)}`;

export function formatBytes(n: number | null | undefined) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** CIP standards: evidence may include BES Cyber System Information (docs/EVIDENCE.md). */
export const isCip = (standard: string | null | undefined) => !!standard && /^CIP-/i.test(standard);

export type Evidence = {
  id: string;
  company_id: string;
  task_id: string | null;
  client_task_id: string | null;
  kind: "file" | "sharepoint" | "link";
  title: string | null;
  url: string | null;
  storage_path: string | null;
  file_name: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  sha256: string | null;
  added_by: string;
  created_at: string;
  removed_at: string | null;
  removed_by: string | null;
};
