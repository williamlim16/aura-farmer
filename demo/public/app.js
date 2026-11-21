// @ts-nocheck -- plain browser script for the local demo, not part of the app build
// Demo UI. All server data is rendered with textContent / value (never innerHTML).
"use strict";

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c) n.append(c);
  return n;
};

const CONTACT_LABELS = {
  fullName: "Full name", firstName: "First name", lastName: "Last name", email: "Email", phone: "Phone",
  location: "Location", linkedin: "LinkedIn URL", github: "GitHub URL", website: "Website",
};
const TIER_LABEL = { rule: "Rules", jev: "Jev", llm: "LLM (mock)", guard: "Safety guard" };
const OUTCOME_LABEL = { verified: "Filled ✓", needs_human: "Needs you", error: "Error", mismatch: "Mismatch", skipped: "Skipped" };

let lastReport = null;

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...(opts.body && !(opts.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...opts.headers } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function showStep(n) {
  for (let i = 1; i <= 4; i++) {
    const done = i < n;
    $(`#step-${i}`).hidden = i > n;
    const chip = document.querySelector(`nav span[data-step="${i}"]`);
    chip.className = i === n ? "active" : done ? "done" : "";
  }
  $(`#step-${n}`).scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Step 1: upload ----------
$("#upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("#resume-file").files[0];
  const status = $("#upload-status");
  status.className = "";
  if (!file) { status.textContent = "Choose a file first."; status.className = "error"; return; }
  const fd = new FormData();
  fd.append("resume", file);
  $("#upload-btn").disabled = true;
  status.textContent = "Uploading and extracting…";
  try {
    const { ok, body } = await api("/api/upload", { method: "POST", body: fd });
    if (!ok) { status.textContent = body.error || "Upload failed."; status.className = "error"; return; }
    status.textContent = `Stored ${body.resume.filename} in memory (${body.resume.path}) and extracted ${body.textChars} characters.`;
    status.className = "ok";
    renderProfile(body.review, body.missing);
    showStep(2);
  } finally {
    $("#upload-btn").disabled = false;
  }
});

// ---------- Step 2: profile review ----------
function sourceBadge(f) {
  if (f.source === "missing") return el("span", { class: "badge missing", text: "not found" });
  if (f.source === "user") return el("span", { class: "badge user", text: "you" });
  const low = f.confidence < 0.8;
  return el("span", { class: `badge ${low ? "low" : "parsed"}`, text: `${f.source === "llm" ? "AI" : "parsed"} ${Math.round(f.confidence * 100)}%` });
}

function row(kind, data = {}) {
  const keys = kind === "exp" ? ["title", "company", "start", "end"] : ["degree", "institution", "start", "end"];
  const labels = kind === "exp" ? ["Title", "Company", "Start", "End"] : ["Degree", "Institution", "Start", "End"];
  const r = el("div", { class: "row", "data-kind": kind });
  keys.forEach((k, i) => r.append(el("label", { text: labels[i] }, el("input", { name: k, value: data[k] || "" }))));
  const rm = el("button", { type: "button", class: "secondary small", text: "Remove" });
  rm.addEventListener("click", () => r.remove());
  r.append(rm);
  return r;
}

function renderProfile(review, missing) {
  const box = $("#contact-fields");
  box.replaceChildren();
  for (const [key, label] of Object.entries(CONTACT_LABELS)) {
    const f = review.contact[key];
    box.append(el("label", {}, document.createTextNode(label), sourceBadge(f), el("input", { name: `contact.${key}`, value: f.value })));
  }
  const form = $("#profile-form");
  form.summary.value = review.summary;
  form.totalYearsExperience.value = review.totalYearsExperience;
  form.skills.value = review.skills;
  for (const [k, v] of Object.entries(review.preferences)) if (form[k]) form[k].value = v;
  $("#experience-rows").replaceChildren(...review.experience.map((e) => row("exp", e)));
  $("#education-rows").replaceChildren(...review.education.map((e) => row("edu", e)));
  const m = $("#missing");
  if (missing && missing.length) {
    m.hidden = false;
    m.textContent = `Not found in the resume: ${missing.join(", ")}. Add them below if you have them.`;
  } else m.hidden = true;
}

$("#add-exp").addEventListener("click", () => $("#experience-rows").append(row("exp")));
$("#add-edu").addEventListener("click", () => $("#education-rows").append(row("edu")));

function collectProfile() {
  const form = $("#profile-form");
  const contact = {};
  for (const key of Object.keys(CONTACT_LABELS)) contact[key] = form[`contact.${key}`].value;
  const rows = (kind) => [...document.querySelectorAll(`.row[data-kind="${kind}"]`)].map((r) =>
    Object.fromEntries([...r.querySelectorAll("input")].map((i) => [i.name, i.value])));
  const preferences = {};
  for (const k of ["workAuthCountry", "workAuthorized", "needsSponsorship", "salaryExpectation", "noticePeriod", "earliestStartDate", "willingToRelocate", "referralSource"]) preferences[k] = form[k].value;
  return { contact, summary: form.summary.value, totalYearsExperience: form.totalYearsExperience.value, skills: form.skills.value, experience: rows("exp"), education: rows("edu"), preferences };
}

$("#profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errBox = $("#profile-errors");
  errBox.hidden = true;
  $("#save-profile").disabled = true;
  try {
    const { ok, body } = await api("/api/profile", { method: "PUT", body: JSON.stringify(collectProfile()) });
    if (!ok) {
      errBox.hidden = false;
      errBox.textContent = body.errors ? Object.entries(body.errors).map(([k, v]) => `${k}: ${v}`).join(" · ") : body.error || "Could not save.";
      return;
    }
    renderProfile(body.review, []);
    $("#profile-status").textContent = "Saved.";
    showStep(3);
  } finally {
    $("#save-profile").disabled = false;
  }
});

// ---------- Step 3: choose form ----------
function renderForms(forms) {
  const list = $("#form-list");
  list.replaceChildren();
  forms.forEach((f, i) => {
    const input = el("input", { type: "radio", name: "form", value: f.file, checked: i === 0 });
    const info = el("div", {}, el("strong", { text: f.title }), el("a", { href: `/forms/${f.file}`, target: "_blank", rel: "noopener", text: "view blank form ↗" }), el("div", { class: "muted", text: f.description }));
    list.append(el("label", { class: "form-option" }, input, info));
  });
}

$("#run-btn").addEventListener("click", async () => {
  const form = document.querySelector('input[name="form"]:checked')?.value;
  const llm = document.querySelector('input[name="llm"]:checked').value;
  const headed = $("#headed").checked;
  const status = $("#run-status");
  $("#run-btn").disabled = true;
  status.textContent = headed ? "Filling in a Chromium window…" : "Filling in a headless browser…";
  try {
    const { ok, body } = await api("/api/run", { method: "POST", body: JSON.stringify({ form, llm, headed }) });
    if (!ok) { status.textContent = body.error || "Run failed."; return; }
    status.textContent = "";
    renderReport(body);
    showStep(4);
  } finally {
    $("#run-btn").disabled = false;
  }
});

// ---------- Step 4: application review ----------
function stat(value, label) {
  return el("div", { class: "stat" }, el("b", { text: String(value) }), el("span", { text: label }));
}

function renderReport(data) {
  lastReport = data;
  const r = data.report, m = r.metrics;
  const blocked = r.blockedSubmits.inPage + r.blockedSubmits.network;
  $("#nothing-submitted").textContent =
    `Nothing was submitted. The form is filled and waiting for your review.` +
    (blocked ? ` The page tried to submit ${blocked} time(s); every attempt was blocked.` : "") +
    (data.submissionsReceived ? ` WARNING: ${data.submissionsReceived} submission(s) reached the server.` : "") +
    (data.headedWindowOpen ? " The Chromium window is still open for you to inspect." : "");
  $("#nothing-submitted").className = data.submissionsReceived ? "error" : "ok";
  $("#summary").replaceChildren(
    stat(m.verified, "filled automatically"),
    stat(m.needsHuman, "need you"),
    stat(m.errors + m.mismatches, "errors / mismatches"),
    stat(`${Math.round(m.requiredCompletion * 100)}%`, "required fields done"),
    stat(m.llmCalls, `model calls (${data.llm})`),
    stat(`${(m.durationMs / 1000).toFixed(1)}s`, "fill time"),
  );
  $("#screenshot").src = data.screenshot;
  $("#raw").textContent = JSON.stringify({ ...data, screenshot: "(omitted)" }, null, 2);
  renderTable();
}

function renderTable() {
  if (!lastReport) return;
  const filter = document.querySelector('input[name="filter"]:checked').value;
  const keep = (f) =>
    filter === "all" ||
    (filter === "filled" && f.outcome === "verified") ||
    (filter === "human" && (f.outcome === "needs_human" || f.outcome === "skipped")) ||
    (filter === "problem" && (f.outcome === "error" || f.outcome === "mismatch"));
  const tbody = $("#fields-table tbody");
  tbody.replaceChildren(
    ...lastReport.report.fields.filter(keep).map((f) => {
      const val = f.outcome === "verified" || f.outcome === "mismatch" ? (typeof f.value === "boolean" ? (f.value ? "checked" : "unchecked") : f.value ?? "(file attached)") : f.reason ?? "";
      const tr = el("tr", { class: f.reviewRequired ? "review" : "" },
        el("td", {}, document.createTextNode(f.label || "(no label)"), f.required ? el("span", { class: "badge", text: "required" }) : null, f.round > 1 ? el("span", { class: "badge", text: `appeared later (round ${f.round})` }) : null),
        el("td", { text: f.kind.replace(/_/g, " ") }),
        el("td", {}, el("span", { class: `badge ${f.tier}`, text: TIER_LABEL[f.tier] || f.tier })),
        el("td", {}, el("span", { class: `badge ${f.outcome}`, text: OUTCOME_LABEL[f.outcome] || f.outcome })),
        el("td", { class: "value", text: String(val) }),
      );
      return tr;
    }),
  );
}
document.querySelectorAll('input[name="filter"]').forEach((i) => i.addEventListener("change", renderTable));
$("#back-to-forms").addEventListener("click", () => showStep(3));
$("#back-to-profile").addEventListener("click", () => showStep(2));
$("#reset").addEventListener("click", async () => {
  await api("/api/reset", { method: "POST" });
  location.reload();
});

// ---------- boot ----------
(async () => {
  const { body } = await api("/api/state");
  renderForms(body.forms);
  if (body.review) {
    renderProfile(body.review, body.missing);
    $("#upload-status").textContent = `Current resume: ${body.resume.filename}`;
    showStep(3);
    $("#step-2").hidden = false;
  }
})();
