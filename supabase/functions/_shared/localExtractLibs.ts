// The npm libraries behind local extraction, loaded only when a file needs them. Kept in its own file with literal
// specifiers so the edge-function bundler includes them, while a failure to load one can never stop a function booting.
import type { LocalLibs } from "./localExtract.ts";

export const localLibs: LocalLibs = {
  loadUnzip: async () => (await import("npm:fflate@0.8.2")).unzipSync as any,
  loadPdf: async () => (await import("npm:unpdf@0.12.1")).extractText as any,
};
