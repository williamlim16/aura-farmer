// @ts-nocheck -- plain browser-extension script (not part of the app build)
const status = document.getElementById("status");
const fill = document.getElementById("fill");
(async () => {
  const { plan } = await chrome.storage.session.get("plan");
  if (!plan) {
    status.textContent = "No application ready. In Aura Farmer, open a filled application and choose “Send to browser extension”.";
    return;
  }
  if (new Date(plan.expiresAt).getTime() < Date.now()) {
    status.textContent = "The handoff expired. Send it again from Aura Farmer.";
    await chrome.storage.session.remove("plan");
    return;
  }
  status.textContent = `Ready: ${plan.title || "application"}${plan.company ? ` at ${plan.company}` : ""} (${plan.fields.length} answers).`;
  fill.disabled = false;
  fill.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["filler.js"] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (p) => window.__auraApplyPlan(p), args: [plan] });
    status.textContent = `Filled ${result.filled.length}; ${result.needsInput.length} need you; ${result.notFound.length} not found on this page.`;
  });
})();
