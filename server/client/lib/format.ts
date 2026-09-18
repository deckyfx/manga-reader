/**
 * Turning what the server sent into something readable.
 *
 * Eden Treaty revives date-like strings into `Date` objects, so a field typed `string` on the server arrives here as
 * a Date. Everything that shows a timestamp goes through this, rather than assuming one shape and crashing on the
 * other — which is exactly what took the account and server pages down.
 */

/** SQLite's `datetime('now')` is UTC without saying so; ISO strings say so themselves. */
function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
  return new Date(sqlite ? `${value.replace(" ", "T")}Z` : value);
}

/** A timestamp in the reader's own timezone, or a word for "it hasn't happened". */
export function when(value: string | Date | null | undefined, never = "never"): string {
  if (!value) return never;
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? never : date.toLocaleString();
}

/** The same, shortened to a date where the time doesn't matter. */
export function onDay(value: string | Date | null | undefined, never = "never"): string {
  if (!value) return never;
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? never : date.toLocaleDateString();
}
