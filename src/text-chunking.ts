export const DEFAULT_TEXT_WINDOW_CHARS = 2000;
export const DEFAULT_TEXT_WINDOW_OVERLAP_CHARS = 50;

export function splitTextIntoOverlappingWindows(
  text: string,
  maxChars = DEFAULT_TEXT_WINDOW_CHARS,
  overlapChars = DEFAULT_TEXT_WINDOW_OVERLAP_CHARS,
): string[] {
  const normalized = text.trim();
  if (normalized === "") return [];
  if (maxChars <= 0) throw new Error("maxChars must be > 0");
  if (overlapChars < 0) throw new Error("overlapChars must be >= 0");
  if (overlapChars >= maxChars) {
    throw new Error("overlapChars must be smaller than maxChars");
  }

  const chars = Array.from(normalized);
  if (chars.length <= maxChars) {
    return [normalized];
  }

  const stride = maxChars - overlapChars;
  const chunks: string[] = [];

  for (let start = 0; start < chars.length; start += stride) {
    const end = Math.min(start + maxChars, chars.length);
    const chunk = chars.slice(start, end).join("").trim();
    if (chunk !== "") {
      chunks.push(chunk);
    }
    if (end >= chars.length) {
      break;
    }
  }

  return chunks;
}

export function countCharacters(text: string): number {
  return Array.from(text).length;
}

export function truncateCharacters(text: string, maxChars: number, suffix = "…"): string {
  const chars = Array.from(text.trim());
  if (chars.length <= maxChars) {
    return chars.join("");
  }

  if (maxChars <= 0) return "";
  if (maxChars <= suffix.length) {
    return chars.slice(0, maxChars).join("");
  }

  return chars.slice(0, maxChars - suffix.length).join("") + suffix;
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
