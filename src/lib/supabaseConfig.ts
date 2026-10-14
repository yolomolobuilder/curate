/**
 * Pure Supabase environment helpers shared by runtime checks and Self-Check.
 * Only publishable browser keys are accepted: modern sb_publishable_* keys or
 * legacy anon JWTs. Secret/service_role keys must never be placed in the client.
 */

export interface NormalizedSupabaseConfig {
  url: string;
  key: string;
}

export function cleanSupabaseEnvValue(value: string | null | undefined): string {
  let cleaned = (value ?? '').trim();

  // Some dashboards/build systems copy values with surrounding quotes.
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

export function normalizeSupabaseConfig(
  urlValue: string | null | undefined,
  keyValue: string | null | undefined,
): NormalizedSupabaseConfig {
  return {
    url: cleanSupabaseEnvValue(urlValue),
    key: cleanSupabaseEnvValue(keyValue),
  };
}

export function isValidSupabaseUrl(url: string): boolean {
  // Require the exact project origin, not a URL with a path, query, or slash.
  if (!url.startsWith('https://') || !url.endsWith('.supabase.co')) return false;

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.endsWith('.supabase.co') &&
      parsed.hostname.length > '.supabase.co'.length &&
      parsed.origin === url
    );
  } catch {
    return false;
  }
}

export function isValidSupabasePublicKey(key: string): boolean {
  // Treat modern publishable keys as opaque strings; don't couple validation
  // to their internal format as Supabase may evolve it.
  if (key.startsWith('sb_publishable_') && key.length > 'sb_publishable_'.length) return true;

  // Legacy anon keys are JWTs with three non-empty base64url segments.
  // Intentionally do not accept sb_secret_* or service_role keys.
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key);
}

export function isValidSupabaseConfig(config: NormalizedSupabaseConfig): boolean {
  return isValidSupabaseUrl(config.url) && isValidSupabasePublicKey(config.key);
}

export function getSupabaseConfigHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function getSupabaseKeyPreview(key: string): string {
  return key ? `${key.slice(0, 12)}…` : 'Missing';
}
