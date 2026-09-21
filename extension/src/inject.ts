/**
 * Getting the content script into a tab before talking to it.
 *
 * The manifest declares no content scripts, so nothing is injected into a page until a feature needs it — browsing
 * costs nothing, and a page the user never scans never runs this extension's code. The price is that every feature
 * which messages the page has to make sure the script is there first. Region scan and Translate image always did;
 * chapter import and "New series from this page" didn't, and answered "Receiving end does not exist" on any tab
 * where neither of the others had been used first.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Injects the content script (and its styles) into `tabId` unless it is already there. Throws when the browser won't
 * let an extension into the page at all — the Web Store, the new-tab page, a PDF viewer — which callers should report
 * as such rather than as a broken extension.
 */
export async function ensureContentScript(tabId: number): Promise<void> {
  const [check] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Boolean((window as unknown as Record<string, unknown>)["__socrLoaded"]),
  });
  if (check?.result) return;

  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  // The script registers its listeners as it loads, so they exist once executeScript resolves; the pause is the
  // margin Region scan has always given it before sending the first message
  await sleep(40);
}
