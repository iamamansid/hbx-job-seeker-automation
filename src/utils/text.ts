export const normalizeForMatch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const normalizeWhitespace = (value: string): string =>
  value
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const uniqueStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

export const includesPattern = (haystack: string, pattern: string): boolean =>
  normalizeForMatch(haystack).includes(normalizeForMatch(pattern));

export const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
};
