/**
 * Per-page overrides for the pipeline's thresholds, for the page the defaults don't suit: a bubble on screentone that
 * flat fill won't take, anti-aliasing the mask misses, a detector that finds too much or too little. Browser-safe, so
 * the Studio shows the same limits and defaults the server enforces.
 *
 * An absent key means the default. Stored as given, never filled in, so a default changed later still reaches every
 * page nobody tuned.
 */

export interface PageTuning {
  /** How far (per colour channel, 0–255) a pixel may be from a bubble's background and still count as background. */
  flat_tolerance?: number;
  /** How many pixels the text mask is grown before cleaning, to take anti-aliased edges too. */
  mask_dilate?: number;
  /** The lowest score a detected text box may have and still count, for whichever detector groups the text. */
  detect_confidence?: number;
}

export type TuningKey = keyof PageTuning;

export interface TuningKnob {
  key: TuningKey;
  label: string;
  /** What raising it does, in one line, for the Studio. */
  hint: string;
  min: number;
  max: number;
  step: number;
  /** Null: the default depends on something else (see `defaultNote`). */
  default: number | null;
  defaultNote?: string;
  /** The stages a change outdates; empty when it only applies to the next run from the original. */
  stale: readonly ("clean_text" | "clean_sfx" | "render")[];
  /** When a change takes effect, if not by running the stale stages again. */
  appliesOn?: string;
}

/** The default flat-fill tolerance; inpaint-service uses this one. */
export const DEFAULT_FLAT_TOLERANCE = 24;
/** The default mask growth; inpaint-service uses this one. */
export const DEFAULT_MASK_DILATE = 4;

export const TUNING_KNOBS: readonly TuningKnob[] = [
  {
    key: "flat_tolerance",
    label: "Flat-fill tolerance",
    hint: "Higher fills more bubbles flat instead of redrawing them; too high fills over tone and shading",
    min: 0,
    max: 96,
    step: 1,
    default: DEFAULT_FLAT_TOLERANCE,
    stale: ["clean_text", "clean_sfx", "render"],
  },
  {
    key: "mask_dilate",
    label: "Mask growth",
    hint: "Higher removes more of each letter's soft edge; too high eats into the art beside it",
    min: 0,
    max: 16,
    step: 1,
    default: DEFAULT_MASK_DILATE,
    stale: ["clean_text", "clean_sfx", "render"],
  },
  {
    key: "detect_confidence",
    label: "Detector confidence",
    hint: "Lower finds fainter text, and more that isn't; higher finds less",
    min: 0.05,
    max: 0.95,
    step: 0.05,
    default: null,
    defaultNote: "0.5 with the bubble detector, 0.4 without",
    stale: [],
    appliesOn: "Run again, which detects the page anew from its original",
  },
];

const KNOBS = new Map(TUNING_KNOBS.map((knob) => [knob.key, knob]));

/** Why `value` can't be stored for `key`, or null when it can. */
export function tuningError(key: TuningKey, value: number): string | null {
  const knob = KNOBS.get(key);
  if (!knob) return `unknown setting "${key}"`;
  if (!Number.isFinite(value) || value < knob.min || value > knob.max) return `${knob.label} must be between ${knob.min} and ${knob.max}`;
  if (knob.step === 1 && !Number.isInteger(value)) return `${knob.label} must be a whole number`;
  return null;
}

/**
 * `current` with `changes` applied: a number sets a key, null clears it back to the default. Keys left out of
 * `changes` are kept.
 */
export function applyTuning(current: PageTuning, changes: { [K in TuningKey]?: number | null }): PageTuning {
  const next: PageTuning = { ...current };
  for (const [key, value] of Object.entries(changes) as [TuningKey, number | null | undefined][]) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** The stages outdated by going from `before` to `after`: only those of the knobs whose value actually changed. */
export function staleStagesFor(before: PageTuning, after: PageTuning): ("clean_text" | "clean_sfx" | "render")[] {
  const stale = new Set<"clean_text" | "clean_sfx" | "render">();
  for (const knob of TUNING_KNOBS) {
    if (before[knob.key] !== after[knob.key]) for (const stage of knob.stale) stale.add(stage);
  }
  return [...stale];
}
