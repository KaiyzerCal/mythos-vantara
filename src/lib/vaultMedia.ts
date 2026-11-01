import { supabase } from "@/integrations/supabase/client";

// vault-media is a PRIVATE bucket (made private in migration 20260331225024),
// but several server-side callers (mavis-chat, mavis-actions) persist
// getPublicUrl() results into file_url columns, and a previously-signed URL's
// token eventually expires too. Both forms 400 when actually fetched. Detect
// either shape and re-sign at read time — self-healing instead of decaying
// into broken tiles, and no backfill migration needed for already-stored rows.
const VAULT_PUBLIC_MARKER = "/storage/v1/object/public/vault-media/";
const VAULT_SIGNED_MARKER = "/storage/v1/object/sign/vault-media/";

export function vaultObjectPathOf(url: string): string | null {
  for (const marker of [VAULT_PUBLIC_MARKER, VAULT_SIGNED_MARKER]) {
    const idx = url.indexOf(marker);
    if (idx !== -1) return decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
  }
  return null;
}

/**
 * Re-signs every vault-media URL in `urls` that needs it, returning a map
 * from the original url to a freshly signed one. URLs that aren't
 * vault-media references (or that fail to sign) are simply absent from the
 * result — callers should fall back to the original url on a map miss.
 */
export async function signVaultUrls(urls: string[]): Promise<Map<string, string>> {
  const pathToUrls = new Map<string, string[]>();
  for (const url of urls) {
    const path = vaultObjectPathOf(url);
    if (!path) continue;
    const existing = pathToUrls.get(path);
    if (existing) existing.push(url);
    else pathToUrls.set(path, [url]);
  }
  if (pathToUrls.size === 0) return new Map();

  const { data, error } = await supabase.storage
    .from("vault-media")
    .createSignedUrls([...pathToUrls.keys()], 60 * 60 * 24 * 7);
  if (error || !data) return new Map();

  const result = new Map<string, string>();
  for (const d of data) {
    if (!d.path || !d.signedUrl) continue;
    for (const originalUrl of pathToUrls.get(d.path) ?? []) {
      result.set(originalUrl, d.signedUrl);
    }
  }
  return result;
}
