function decodeArrowsAppImportUrl(input: string): string | null {
  const m = /[#/]?\/?import\/json=([^&\s]+)/.exec(input);
  if (!m) return null;
  try {
    return Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8');
  } catch {
    return null;
  }
}

// Mirrors the Kotlin host's parseImportInput cap; bounds decode/parse of a pasted share URL.
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export function parseImportInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_IMPORT_BYTES) return null;
  if (/^https?:\/\//i.test(trimmed) || /import\/json=/.test(trimmed)) {
    return decodeArrowsAppImportUrl(trimmed);
  }
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes)) {
        return trimmed;
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}
