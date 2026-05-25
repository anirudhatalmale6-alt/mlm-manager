// TM Passkey Manager — Content script (ISOLATED world)
// Bridges messages between inject.js (MAIN world) and background.js (service worker)

const EXTENSION_ID = '__TM_PASSKEY__';

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== EXTENSION_ID) return;
  if (event.data.direction !== 'to-background') return;

  const { id, data } = event.data;

  chrome.runtime.sendMessage(data, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[TM-Passkey] Bridge error:', chrome.runtime.lastError.message);
      window.postMessage({
        source: EXTENSION_ID,
        direction: 'to-page',
        id,
        response: { error: chrome.runtime.lastError.message }
      }, '*');
      return;
    }
    window.postMessage({
      source: EXTENSION_ID,
      direction: 'to-page',
      id,
      response: response || { error: 'No response from background' }
    }, '*');
  });
});

console.log('[TM-Passkey] Content script bridge loaded');
