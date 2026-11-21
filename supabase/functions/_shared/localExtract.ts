// ── Local document text extraction (no AI, no credits) ───────────────────────
// PDFs with a text layer and Word / Excel / PowerPoint files carry their text inside the file, so reading it needs no
// model at all. Used before any paid provider, and for the formats the AI cascade never handled (docx/xlsx/pptx).
// Libraries are loaded lazily so a failure to load one can never stop a function from booting; every export returns
// null when it can't read something, and the caller falls back to the AI cascade.

type Unzip = (data: Uint8Array) => Record<string, Uint8Array>;
type PdfExtract = (data: Uint8Array, opts?: { mergePages?: boolean }) => Promise<{ text: string | string[]; totalPages: number }>;
// Either the libraries themselves (tests) or lazy loaders (edge functions: see localExtractLibs.ts, which holds the literal
// npm: imports the deploy bundler needs to see).
export interface LocalLibs {
  unzipSync?: Unzip;
  extractText?: PdfExtract;
  loadUnzip?: () => Promise<Unzip>;
  loadPdf?: () => Promise<PdfExtract>;
}

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export type LocalKind = "pdf" | "docx" | "xlsx" | "pptx";

export function localKind(mime: string, fileName: string): LocalKind | null {
  const m = (mime || "").toLowerCase();
  const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)(?:\s*\(\d+\))?$/)?.[1]) ?? "";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m === MIME.docx || ext === "docx") return "docx";
  if (m === MIME.xlsx || ext === "xlsx") return "xlsx";
  if (m === MIME.pptx || ext === "pptx") return "pptx";
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENTITIES[n]);
}

const utf8 = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

/** Word: paragraphs and tabs from word/document.xml, plus headers/footers' text is ignored on purpose. */
export function docxText(files: Record<string, Uint8Array>): string {
  const doc = files["word/document.xml"];
  if (!doc) return "";
  const xml = utf8(doc);
  return decodeXml(
    xml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, "$1")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\n{3,}/g, "\n\n").trim();
}

/** PowerPoint: the text runs of every slide in order. */
export function pptxText(files: Record<string, Uint8Array>): string {
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const out: string[] = [];
  slides.forEach((name, i) => {
    const xml = utf8(files[name]);
    const text = decodeXml(xml.replace(/<\/a:p>/g, "\n").replace(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g, "$1").replace(/<[^>]+>/g, "")).replace(/\n{2,}/g, "\n").trim();
    if (text) out.push(`## Slide ${i + 1}\n${text}`);
  });
  return out.join("\n\n");
}

/** Excel: every sheet as tab-separated rows (shared strings resolved). */
export function xlsxText(files: Record<string, Uint8Array>): string {
  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    for (const si of utf8(files["xl/sharedStrings.xml"]).match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeXml((si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
    }
  }
  const names = new Map<string, string>();
  const wb = files["xl/workbook.xml"] ? utf8(files["xl/workbook.xml"]) : "";
  const rels = files["xl/_rels/workbook.xml.rels"] ? utf8(files["xl/_rels/workbook.xml.rels"]) : "";
  const relTarget = new Map<string, string>();
  for (const r of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = r.match(/Id="([^"]+)"/)?.[1]; const target = r.match(/Target="([^"]+)"/)?.[1];
    if (id && target) relTarget.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  for (const s of wb.match(/<sheet\b[^>]*>/g) ?? []) {
    const name = s.match(/name="([^"]*)"/)?.[1]; const rid = s.match(/r:id="([^"]+)"/)?.[1];
    const target = rid ? relTarget.get(rid) : undefined;
    if (name && target) names.set(target, decodeXml(name));
  }
  const sheetFiles = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const out: string[] = [];
  for (const f of sheetFiles) {
    const xml = utf8(files[f]);
    const rows: string[] = [];
    for (const row of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
      const cells: string[] = [];
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const t = c.match(/\bt="([^"]+)"/)?.[1];
        const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const inline = c.match(/<is>[\s\S]*?<\/is>/)?.[0];
        let val = "";
        if (t === "s" && v != null) val = shared[Number(v)] ?? "";
        else if (t === "inlineStr" && inline) val = decodeXml((inline.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, "")).join(""));
        else if (v != null) val = decodeXml(v);
        cells.push(val);
      }
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (cells.length) rows.push(cells.join("\t"));
    }
    if (rows.length) out.push(`## Sheet: ${names.get(f) ?? f.replace(/^xl\/worksheets\//, "").replace(/\.xml$/, "")}\n${rows.join("\n")}`);
  }
  return out.join("\n\n");
}

async function loadUnzip(libs?: LocalLibs): Promise<Unzip | null> {
  if (libs?.unzipSync) return libs.unzipSync;
  try { return libs?.loadUnzip ? await libs.loadUnzip() : null; } catch { return null; }
}
async function loadPdf(libs?: LocalLibs) {
  if (libs?.extractText) return libs.extractText;
  try { return libs?.loadPdf ? await libs.loadPdf() : null; } catch { return null; }
}

/** Text of a PDF's text layer. Returns null for scans (no text layer) so the caller can use OCR/vision. */
export async function pdfText(data: Uint8Array, libs?: LocalLibs): Promise<string | null> {
  try {
    const extract = await loadPdf(libs);
    if (!extract) return null;
    const { text } = await extract(data, { mergePages: true });
    const t = (Array.isArray(text) ? text.join("\n\n") : String(text ?? "")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return t.length >= 40 ? t : null; // a handful of characters is a scan with stray marks, not a document
  } catch {
    return null;
  }
}

/** Best-effort local extraction by file type. null = could not read it here. Never throws. */
export async function extractLocalText(buf: ArrayBuffer, mime: string, fileName: string, libs?: LocalLibs): Promise<string | null> {
  try {
    const kind = localKind(mime, fileName);
    if (!kind) return null;
    const data = new Uint8Array(buf);
    if (kind === "pdf") return await pdfText(data, libs);
    const unzip = await loadUnzip(libs);
    if (!unzip) return null;
    const files = unzip(data);
    const text = kind === "docx" ? docxText(files) : kind === "pptx" ? pptxText(files) : xlsxText(files);
    return text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}
