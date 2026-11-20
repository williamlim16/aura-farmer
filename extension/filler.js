// @ts-nocheck -- plain browser-extension script (not part of the app build)
// Aura Farmer handoff filler. Runs in the user's own tab (injected by the
// extension popup). Fills fields by their visible labels, highlights what it
// filled and what still needs the person, and NEVER submits the form.
// No dependencies; also loaded directly by the test suite.
(function () {
  "use strict";
  const norm = (s) => String(s || "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim().toLowerCase();
  const textOf = (el) => (el ? el.textContent || "" : "");

  function labelOf(el) {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return textOf(l);
    }
    const wrap = el.closest("label");
    if (wrap) {
      const c = wrap.cloneNode(true);
      c.querySelectorAll("input,select,textarea,option").forEach((n) => n.remove());
      if (norm(c.textContent)) return c.textContent;
    }
    const lb = el.getAttribute("aria-labelledby");
    if (lb) return lb.split(/\s+/).map((i) => textOf(document.getElementById(i))).join(" ");
    return el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
  }

  function groupLabel(input) {
    const rg = input.closest("[role=radiogroup],[role=group]");
    if (rg) {
      const lb = rg.getAttribute("aria-labelledby");
      if (lb) return textOf(document.getElementById(lb));
      if (rg.getAttribute("aria-label")) return rg.getAttribute("aria-label");
    }
    const fs = input.closest("fieldset");
    return fs && fs.querySelector("legend") ? textOf(fs.querySelector("legend")) : "";
  }

  // Set a value the way a user would, so React/Vue controlled inputs register it.
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function mark(el, kind, note) {
    el.style.outline = kind === "filled" ? "2px solid #16a34a" : "2px solid #d97706";
    el.style.outlineOffset = "2px";
    if (note) el.setAttribute("title", note);
    el.setAttribute("data-aura-handoff", kind);
  }

  function applyPlan(plan) {
    if (!plan || plan.version !== 1) throw new Error("Unsupported fill plan.");
    if (new Date(plan.expiresAt).getTime() < Date.now()) throw new Error("This handoff has expired. Send it again from Aura Farmer.");
    const controls = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea"));
    const result = { filled: [], notFound: [], needsInput: [] };

    for (const f of plan.fields) {
      const want = norm(f.label);
      if (f.control === "radio") {
        const radios = controls.filter((c) => c.type === "radio" && norm(groupLabel(c)) === want);
        const pick = radios.find((r) => norm(labelOf(r)) === norm(f.value));
        if (pick) {
          pick.click();
          mark(pick.closest("fieldset,[role=radiogroup]") || pick, "filled");
          result.filled.push(f.label);
        } else result.notFound.push(f.label);
        continue;
      }
      const el = controls.find((c) => c.type !== "radio" && norm(labelOf(c)) === want);
      if (!el) {
        result.notFound.push(f.label);
        continue;
      }
      if (el.type === "checkbox") {
        if (el.checked !== (f.value === true)) el.click();
      } else if (el instanceof HTMLSelectElement) {
        const opt = Array.from(el.options).find((o) => norm(o.textContent) === norm(f.value));
        if (!opt) {
          result.notFound.push(f.label);
          continue;
        }
        setNativeValue(el, opt.value);
      } else {
        setNativeValue(el, String(f.value));
      }
      mark(el, f.reviewRequired ? "review" : "filled", f.reviewRequired ? "AI draft: please edit" : "Filled by Aura Farmer");
      result.filled.push(f.label);
    }

    // Resume upload via DataTransfer (allowed in a page context the user initiated).
    if (plan.resume) {
      const file = controls.find((c) => c.type === "file" && /resume|cv/i.test(labelOf(c)));
      if (file) {
        const bytes = Uint8Array.from(atob(plan.resume.base64), (ch) => ch.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], plan.resume.filename, { type: "application/pdf" }));
        file.files = dt.files;
        file.dispatchEvent(new Event("change", { bubbles: true }));
        mark(file, "filled");
        result.filled.push(labelOf(file).trim());
      }
    }

    for (const n of plan.needsInput) {
      const want = norm(n.label);
      const el = controls.find((c) => norm(labelOf(c)) === want || norm(groupLabel(c)) === want);
      if (el) mark(el.closest("fieldset,[role=radiogroup]") || el, "needs", n.reason);
      result.needsInput.push(n.label);
    }

    const panel = document.createElement("div");
    panel.setAttribute("role", "status");
    panel.setAttribute("data-aura-panel", "1");
    panel.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;background:#fff;border:1px solid #ccc;border-radius:8px;padding:12px;font:13px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.15)";
    panel.textContent = "Aura Farmer filled " + result.filled.length + " field(s). " + result.needsInput.length + " need your input (amber). Review everything, then submit the form yourself.";
    document.body.appendChild(panel);
    return result;
  }

  window.__auraApplyPlan = applyPlan;
})();
