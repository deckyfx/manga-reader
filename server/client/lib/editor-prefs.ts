/**
 * The page editor's habits, remembered per browser. Storage can be unavailable (private mode), so every read falls
 * back to the default and every write is best effort.
 */
const PANEL_COLLAPSED_KEY = "studio-editor-panel-collapsed";

/** Saved side-panel state; defaults to expanded. */
export function readPanelCollapsed(): boolean {
  try {
    return localStorage.getItem(PANEL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function savePanelCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Not persisted; the choice still applies for this visit
  }
}

const HUD_KEY = "studio-editor-hud";

/** Whether the machine's readings are on show; defaults to off, since most work doesn't need them. */
export function readHudOpen(): boolean {
  try {
    return localStorage.getItem(HUD_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveHudOpen(open: boolean): void {
  try {
    localStorage.setItem(HUD_KEY, open ? "1" : "0");
  } catch {
    // Not persisted; the choice still applies for this visit
  }
}
