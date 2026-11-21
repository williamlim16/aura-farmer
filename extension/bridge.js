// @ts-nocheck -- plain browser-extension script (not part of the app build)
// Runs on the Aura Farmer app origin only. Accepts a fill plan from the app
// page (same window, same origin) and passes it to the extension. Nothing else.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const msg = event.data;
  if (!msg || msg.type !== "aura-farmer:fill-plan" || !msg.plan || msg.plan.version !== 1) return;
  chrome.runtime.sendMessage({ type: "aura-farmer:store-plan", plan: msg.plan }).then((res) => {
    if (res && res.ok) window.postMessage({ type: "aura-farmer:fill-plan-received", applicationId: msg.plan.applicationId }, window.location.origin);
  });
});
