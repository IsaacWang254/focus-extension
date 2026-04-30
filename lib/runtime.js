/**
 * Shared chrome.runtime messaging shim. In a real extension context messages
 * go to the service worker; in a preview/dev context (e.g. opening the HTML
 * file directly) the caller-supplied previewResponder fills in fake data.
 */

export function hasExtensionRuntime() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
}

export function createRuntimeMessenger(previewResponder = () => null) {
  return async function sendRuntimeMessage(message) {
    if (hasExtensionRuntime()) return chrome.runtime.sendMessage(message);
    return previewResponder(message);
  };
}
