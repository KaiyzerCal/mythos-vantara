// _shared/pagination.ts
// The Supabase/PostgREST gateway on this project hard-caps every response at
// 1000 rows server-side regardless of client request shape (confirmed live:
// a skills fetch was silently truncating to 1000 of 1204 rows, dropping
// ~204 skills — including a chunk of the Beyonder tree — with no error).
// Page through in 1000-row chunks instead of a single unbounded select.
// Was duplicated per-edge-function (mavis-chain-builder had its own copy);
// one shared implementation so it can't drift or get missed in a new one.
const GATEWAY_PAGE_SIZE = 1000;

export async function fetchAllRows(sb: any, table: string, cols: string, userId: string): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).eq("user_id", userId).range(offset, offset + GATEWAY_PAGE_SIZE - 1);
    if (error) throw error;
    if (data) rows.push(...data);
    if (!data || data.length < GATEWAY_PAGE_SIZE) break;
    offset += GATEWAY_PAGE_SIZE;
  }
  return rows;
}
