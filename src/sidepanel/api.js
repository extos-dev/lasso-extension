// Thin wrapper around tabs/scripting/messaging. The panel never touches storage directly: it asks the background.
import { CONTENT_FILES } from '../shared/content-files.js';

export async function activeTab() { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return t || null; }

export async function send(tabId, type, payload = {}) {
  const r = await chrome.tabs.sendMessage(tabId, { lasso: true, type, ...payload });
  if (!r || !r.ok) throw new Error((r && r.error) || 'No response from page');
  return r.data;
}

/** Inject (or refresh) the engine. Required http(s) host access covers regular pages. */
export async function ensureEngine(tabId) {
  const version = chrome.runtime.getManifest().version;
  try { const p = await send(tabId, 'PING'); if (p.version === version) return; } catch (_) { /* not injected yet */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
}

export async function bg(type, payload = {}) {
  const r = await chrome.runtime.sendMessage({ lasso: true, type, ...payload });
  if (!r || !r.ok) throw new Error((r && r.error) || 'Background error');
  return r.data;
}

export const isPermissionError = (e) => /cannot access|missing host permission|activeTab|permission|not allowed/i.test(String((e && e.message) || e));

export const isRestricted = (url = '') => !url || /^(chrome|edge|about|file|chrome-extension|view-source|devtools):/i.test(url) || /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url);

/** Honest message per restricted scheme: a file:// page can never be injected (no host permission). */
export const restrictedMessage = (url = '') => /^file:/i.test(url)
  ? 'Lasso can’t run on file:// pages. Serve the file over http:// instead, or open a regular web page.'
  : 'Lasso can’t run on browser pages or the Web Store. Open a regular web page.';

export async function scanAllPage(tabId, patterns) {
  const res = await send(tabId, 'SCAN_RUN', patterns ? { patterns } : {});
  // handle both formats
  if (res && res.results) return res;
  if (res && res.data && res.data.results) return res.data;
  if (res && res.data) return res.data;
  return res;
}

export async function scanSetScope(tabId, nodeId) {
  return send(tabId, 'SCAN_SET_SCOPE', { nodeId });
}

export async function scanGetScope(tabId) {
  return send(tabId, 'SCAN_GET_SCOPE');
}

export async function scanClearScope(tabId) {
  return send(tabId, 'SCAN_CLEAR_SCOPE');
}
