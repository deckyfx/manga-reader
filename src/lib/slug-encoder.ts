/**
 * Slug encoder for converting integer IDs to compact text slugs
 *
 * Format: ${prefix}${encoded_id}
 * - Series: s00001, s00002, ...
 * - Chapter: c00001, c00002, ...
 * - Page: p00001, p00002, ...
 */

const CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const BASE = CHARS.length; // 62

/**
 * Encode integer to base62 string (min 5 characters, padded)
 */
export function encodeId(n: number): string {
  if (n === 0) return "00000";

  let result = "";
  let num = n;

  while (num > 0) {
    result = CHARS[num % BASE] + result;
    num = Math.floor(num / BASE);
  }

  // Pad to minimum 5 characters
  return result.padStart(5, "0");
}

/**
 * Decode base62 string back to integer
 */
export function decodeId(str: string): number {
  let result = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i]!;
    const value = CHARS.indexOf(char);
    if (value === -1) {
      throw new Error(`Invalid character in slug: ${char}`);
    }
    result = result * BASE + value;
  }

  return result;
}

/**
 * Generate slug with prefix (used in SQLite triggers)
 */
export function generateSlug(prefix: string, id: number): string {
  return `${prefix}${encodeId(id)}`;
}

/**
 * Parse slug to get prefix and ID
 */
export function parseSlug(slug: string): { prefix: string; id: number } {
  if (!slug) {
    throw new Error("Invalid slug");
  }
  const prefix = slug[0]!;
  const encoded = slug.slice(1);
  const id = decodeId(encoded);

  return { prefix, id };
}
