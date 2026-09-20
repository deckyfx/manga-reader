import { start as startImportPanel } from "./popup-import";
import type { PopupModeMsg } from "./types";

document.getElementById("btn-region")?.addEventListener("click", () => {
  sendMode("region");
});

document.getElementById("btn-image")?.addEventListener("click", () => {
  sendMode("image");
});

function sendMode(mode: "region" | "image"): void {
  const msg: PopupModeMsg = { type: "popup-mode", mode };
  chrome.runtime.sendMessage(msg).catch(console.error);
  window.close();
}

// The import panel decides for itself what to show: a running import, what this page holds, or why neither applies
void startImportPanel();
