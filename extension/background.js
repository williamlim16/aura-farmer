// @ts-nocheck -- plain browser-extension script (not part of the app build)
// Stores the fill plan sent by the bridge. storage.session is only reachable
// from trusted extension contexts, so content scripts hand the plan to us.
const APP_ORIGINS = [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const origin = sender.url ? new URL(sender.url).origin : "";
  if (!sender.tab || !APP_ORIGINS.some((re) => re.test(origin))) return false;
  if (!msg || msg.type !== "aura-farmer:store-plan" || !msg.plan || msg.plan.version !== 1) return false;
  chrome.storage.session.set({ plan: msg.plan }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true; // async response
});
