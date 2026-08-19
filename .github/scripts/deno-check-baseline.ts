/**
 * Regenerates .github/deno-check-baseline.json — the per-function type-error
 * budget enforced by .github/workflows/deno-check.yml.
 *
 * Run from the repo root:
 *   deno run -A .github/scripts/deno-check-baseline.ts > .github/deno-check-baseline.json
 *
 * Functions with zero errors are omitted; the workflow treats a missing key as
 * a budget of 0, so clean functions must stay clean.
 */

const FUNCS = "supabase/functions";
const ANSI = /\x1b\[[0-9;]*m/g;
const DIAG = /^TS\d+ \[ERROR\]/;

const skip = new Set(["_archive", "_shared"]);
const baseline: Record<string, number> = {};

for await (const entry of Deno.readDir(FUNCS)) {
  if (!entry.isDirectory || skip.has(entry.name)) continue;
  const path = `${FUNCS}/${entry.name}/index.ts`;
  try {
    if (!(await Deno.stat(path)).isFile) continue;
  } catch {
    continue;
  }

  const cmd = new Deno.Command("deno", { args: ["check", path], stdout: "piped", stderr: "piped" });
  const { stdout, stderr } = await cmd.output();
  const text = (new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)).replace(ANSI, "");

  // Count diagnostics directly. `deno check` only prints "Found N errors."
  // when N > 1, so the summary line cannot be relied on for the N === 1 case.
  const count = text.split("\n").filter((l) => DIAG.test(l)).length;
  if (count > 0) baseline[entry.name] = count;
  console.error(`${entry.name}: ${count}`);
}

const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)));
console.log(JSON.stringify(sorted, null, 2));
