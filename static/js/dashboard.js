function safeRun(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`OMINI: "${label}" failed to initialize, other features remain active.`, err);
  }
}

function hydrateIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    try { window.lucide.createIcons(); } catch (e) { /* icon lib unavailable, degrade gracefully */ }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  safeRun("initial icon hydration", hydrateIcons);

  // ---------------- Sidebar / section navigation ----------------
  function goToSection(name) {
    document.querySelectorAll(".dash-section").forEach(s => s.classList.add("hidden"));
    const target = document.getElementById("section-" + name);
    if (target) target.classList.remove("hidden");
    document.querySelectorAll("#side-nav .nav-item").forEach(b => b.classList.remove("active"));
    const navBtn = document.querySelector(`#side-nav .nav-item[data-section="${name}"]`);
    if (navBtn) navBtn.classList.add("active");
  }

  safeRun("sidebar navigation", () => {
    document.querySelectorAll("[data-section]").forEach(btn => {
      btn.addEventListener("click", () => goToSection(btn.dataset.section));
    });
  });

  // ---------------- Robot instance (home) ----------------
  let homeRobot = { setState: () => {}, speak: () => {} };
  safeRun("3D robot", () => {
    if (window.OminiRobot) homeRobot = OminiRobot.build("home-robot") || homeRobot;
  });

  function setHomeStatus(state, label) {
    const chip = document.getElementById("home-status");
    const lbl = document.getElementById("home-status-label");
    if (chip) chip.className = "omini-status-chip " + state;
    if (lbl) lbl.textContent = label;
    homeRobot.setState(state);
  }

  // ---------------- Stats ----------------
  function refreshStats() {
    fetch("/api/stats").then(r => r.json()).then(d => {
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      set("stat-cases", d.cases_analyzed ?? 0);
      set("stat-policies", d.policies_scanned ?? 0);
      set("stat-courtroom", d.courtroom_sessions ?? 0);
      set("stat-success", (d.success_rate ?? 92) + "%");
    }).catch(() => {});
  }
  safeRun("stats", refreshStats);

  // ---------------- Shared chat helpers ----------------
  function appendMsg(container, role, text) {
    const el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : "omini");
    el.textContent = text;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  function showThinking(container) {
    const el = document.createElement("div");
    el.className = "msg thinking";
    el.innerHTML = "<span></span><span></span><span></span>";
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  const NO_KEY_FALLBACK = "OMINI couldn't respond because no Groq API key is configured on the server yet.";
  const askChatLog = document.getElementById("ask-chat-log");

  async function sendChatMessage(message, container, { isHome = false } = {}) {
    if (!message || !message.trim()) return;
    appendMsg(container, "user", message);
    if (isHome) setHomeStatus("thinking", "Thinking...");
    const thinkingEl = showThinking(container);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      thinkingEl.remove();
      if (data.error) {
        appendMsg(container, "omini", data.message || NO_KEY_FALLBACK);
        if (isHome) setHomeStatus("sad", "Needs setup");
        return;
      }
      appendMsg(container, "omini", data.reply);
      if (isHome) {
        setHomeStatus("talking", "Speaking...");
        setTimeout(() => setHomeStatus("idle", "Idle"), 2200);
      }
    } catch (e) {
      thinkingEl.remove();
      appendMsg(container, "omini", "Connection error — please try again.");
      if (isHome) setHomeStatus("sad", "Connection error");
    }
  }

  // ---------------- Home mini-chat (routes into Ask OMINI log) ----------------
  safeRun("home chat", () => {
    const homeInput = document.getElementById("home-chat-input");
    const homeSendBtn = document.getElementById("home-send-btn");
    if (!homeInput || !homeSendBtn || !askChatLog) return;

    function sendFromHome() {
      const msg = homeInput.value;
      homeInput.value = "";
      goToSection("ask");
      sendChatMessage(msg, askChatLog, { isHome: true });
    }

    homeSendBtn.addEventListener("click", sendFromHome);
    homeInput.addEventListener("keydown", e => { if (e.key === "Enter") sendFromHome(); });

    document.querySelectorAll(".suggestion-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        homeInput.value = chip.dataset.prompt;
        sendFromHome();
      });
    });
  });

  // ---------------- Full Ask OMINI chat ----------------
  safeRun("ask omini chat", () => {
    const askInput = document.getElementById("ask-chat-input");
    const askSendBtn = document.getElementById("ask-send-btn");
    if (!askInput || !askSendBtn || !askChatLog) return;

    function sendFromAsk() {
      const msg = askInput.value;
      askInput.value = "";
      sendChatMessage(msg, askChatLog, { isHome: false });
    }
    askSendBtn.addEventListener("click", sendFromAsk);
    askInput.addEventListener("keydown", e => { if (e.key === "Enter") sendFromAsk(); });

    fetch("/api/chat/history").then(r => r.json()).then(rows => {
      rows.forEach(r => appendMsg(askChatLog, r.role === "user" ? "user" : "omini", r.content));
    }).catch(() => {});
  });

  // ---------------- Voice input (Web Speech API) ----------------
  safeRun("voice input", () => {
    function wireMic(btnId, inputEl) {
      const btn = document.getElementById(btnId);
      if (!btn || !inputEl) return;
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { btn.title = "Voice input not supported in this browser"; return; }
      const recog = new SpeechRecognition();
      recog.continuous = false;
      recog.lang = "en-US";
      btn.addEventListener("click", () => {
        setHomeStatus("listening", "Listening...");
        try { recog.start(); } catch (e) { /* already started */ }
      });
      recog.onresult = (e) => {
        inputEl.value = e.results[0][0].transcript;
        setHomeStatus("idle", "Idle");
      };
      recog.onerror = () => setHomeStatus("idle", "Idle");
      recog.onend = () => setHomeStatus("idle", "Idle");
    }
    wireMic("home-mic-btn", document.getElementById("home-chat-input"));
    wireMic("ask-mic-btn", document.getElementById("ask-chat-input"));
  });

  // ---------------- Shared render helpers ----------------
  function riskColor(score) {
    if (score < 34) return { cls: "low", color: "#33e29a" };
    if (score < 67) return { cls: "medium", color: "#ffb84d" };
    return { cls: "high", color: "#ff5470" };
  }

  function emptyState(icon, text) {
    return `<div class="empty-state"><div class="es-icon" data-lucide="${icon}"></div><p>${text}</p></div>`;
  }

  function listBlock(title, arr) {
    if (!arr || !arr.length) return "";
    return `<div class="result-block"><h5>${title}</h5><ul>${arr.map(x => `<li>${x}</li>`).join("")}</ul></div>`;
  }

  // Rough keyword-based severity classifier — used only when the AI response
  // doesn't already carry a severity/risk_level for an individual item.
  function inferSeverity(text) {
    const t = (text || "").toLowerCase();
    const high = ["sell", "sold", "without consent", "indefinitely", "no limit", "unlimited",
      "third-party", "third party", "waive", "arbitration", "class action", "without notice",
      "any purpose", "not obligated", "no liability", "sole discretion", "at any time without"];
    const medium = ["vague", "unclear", "may share", "may collect", "reserve the right",
      "discretion", "subject to change", "not specified", "ambiguous", "broad"];
    if (high.some(k => t.includes(k))) return "high";
    if (medium.some(k => t.includes(k))) return "medium";
    return null;
  }

  function classifyRedFlags(list) {
    const arr = list || [];
    return arr.map((rf, i) => {
      const item = typeof rf === "string" ? { clause: rf, why_risky: "" } : rf;
      const text = `${item.clause || ""} ${item.why_risky || item.why || ""}`;
      let sev = item.severity || item.risk_level || inferSeverity(text);
      if (!sev) sev = i < Math.ceil(arr.length / 2) ? "high" : "medium";
      return { ...item, severity: String(sev).toLowerCase() };
    });
  }

  function severityTag(sev) {
    const map = { high: { cls: "high", label: "High" }, medium: { cls: "medium", label: "Medium" }, low: { cls: "low", label: "Low" } };
    const m = map[sev] || map.medium;
    return `<span class="tag ${m.cls} flex-shrink-0">${m.label}</span>`;
  }

  function buildBreakdown(data, flags) {
    const high = flags.filter(f => f.severity === "high").length;
    const medium = flags.filter(f => f.severity === "medium").length;
    const low = (data.key_risks || []).length;
    const info = (data.hidden_clauses || []).length + (data.data_collected || []).length;
    const total = (high + medium + low + info) || 1;
    return [
      { label: "High Risk", count: high, color: "#ff5470", pct: Math.round((high / total) * 100) },
      { label: "Medium Risk", count: medium, color: "#ffb84d", pct: Math.round((medium / total) * 100) },
      { label: "Low Risk", count: low, color: "#33e29a", pct: Math.round((low / total) * 100) },
      { label: "Informational", count: info, color: "#2fd8ff", pct: Math.round((info / total) * 100) },
    ];
  }

  function donutSvg(breakdown, score) {
    const r = 42, C = 2 * Math.PI * r;
    let acc = 0;
    const segs = breakdown.filter(b => b.count > 0).map(b => {
      const len = (b.pct / 100) * C;
      const seg = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${b.color}" stroke-width="14" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}" stroke-linecap="butt"/>`;
      acc += len;
      return seg;
    }).join("");
    return `
      <div class="relative w-[130px] h-[130px] flex-shrink-0">
        <svg width="130" height="130" viewBox="0 0 120 120" class="-rotate-90">
          <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="14"/>
          ${segs}
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <div class="font-mono font-bold text-xl">${score}%</div>
        </div>
      </div>`;
  }

  function statCard(icon, colorHex, value, label, sub) {
    return `
      <div class="stat-card">
        <div class="stat-icon-wrap" style="background:${colorHex}22;color:${colorHex}"><i data-lucide="${icon}" class="w-4 h-4"></i></div>
        <div class="stat-value">${value}</div>
        <div class="stat-label">${label}</div>
        ${sub ? `<span class="tag ${sub.cls} mt-0.5 w-fit">${sub.text}</span>` : ""}
      </div>`;
  }

  function ovCard(icon, colorClasses, text) {
    return `<div class="ov-card"><div class="ov-icon ${colorClasses}"><i data-lucide="${icon}" class="w-4 h-4"></i></div><p class="text-sm leading-relaxed">${text}</p></div>`;
  }

  function renderAnalysis(container, data) {
    const score = data.danger_score ?? 0;
    const risk = riskColor(score);
    const dataPoints = data.data_collected || [];
    const keyRisks = data.key_risks || [];
    const hidden = data.hidden_clauses || [];
    const rights = data.user_rights || [];
    const recs = data.recommendations || [];
    const flags = classifyRedFlags(data.red_flags);
    const breakdown = buildBreakdown(data, flags);

    // ---- Stat strip ----
    const statHtml = `<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
      ${statCard("gauge", risk.color, score + "%", "Overall Risk Score", { cls: risk.cls, text: data.risk_level || risk.cls.toUpperCase() })}
      ${statCard("database", "#2fd8ff", dataPoints.length, "Key Points Found")}
      ${statCard("alert-circle", "#9b5cff", keyRisks.length, "Risks Identified")}
      ${statCard("flag", "#ff5470", flags.length, "Red Flags")}
      ${statCard("check-circle-2", "#33e29a", recs.length, "Recommendations")}
    </div>`;

    // ---- Tabs ----
    const tabs = [
      { id: "overview", label: "Overview", icon: "layout-dashboard" },
      { id: "points", label: "Key Points", icon: "database" },
      { id: "clauses", label: "Risks & Clauses", icon: "file-warning" },
      { id: "rights", label: "Your Rights", icon: "user-check" },
      { id: "flags", label: "Red Flags", icon: "flag", badge: flags.length },
      { id: "recs", label: "Recommendations", icon: "lightbulb" },
      { id: "report", label: "Full Report", icon: "file-text" },
    ];
    const tabsHtml = `<div class="dtabs">${tabs.map((t, i) => `
      <button class="dtab${i === 0 ? " active" : ""}" data-tab="${t.id}">
        <i data-lucide="${t.icon}" class="w-3.5 h-3.5"></i> ${t.label}${t.badge ? ` <span class="tag high ml-1">${t.badge}</span>` : ""}
      </button>`).join("")}</div>`;

    // ---- Overview panel ----
    const wellText = data.summary ? data.summary.split(". ").slice(0, 1).join(". ") + "." : "This document was reviewed for scope, obligations, and overall risk.";
    const firstHidden = hidden[0] ? (typeof hidden[0] === "string" ? hidden[0] : hidden[0].clause) : null;
    const attentionText = firstHidden || keyRisks[0] || "No specific sections were flagged for attention.";
    const riskText = flags.length
      ? `${flags.length} red flag${flags.length === 1 ? "" : "s"} found, including "${(flags[0].clause || "").toString().slice(0, 70)}".`
      : "No major red flags were detected in this document.";

    const overviewHtml = `
      <div class="grid md:grid-cols-3 gap-3 mb-5">
        ${ovCard("thumbs-up", "bg-success/15 text-success", `<span class="font-semibold text-sm block mb-1">What looks fine</span>${wellText}`)}
        ${ovCard("alert-triangle", "bg-warning/15 text-warning", `<span class="font-semibold text-sm block mb-1">Needs attention</span>${attentionText}`)}
        ${ovCard("shield-alert", "bg-danger/15 text-danger", `<span class="font-semibold text-sm block mb-1">Potential risks</span>${riskText}`)}
      </div>
      <div class="dpanel mb-5">
        <h5 class="text-xs uppercase tracking-wide text-neonsoft mb-4">Risk Breakdown</h5>
        <div class="flex flex-col sm:flex-row items-center gap-6">
          ${donutSvg(breakdown, score)}
          <div class="w-full">
            ${breakdown.map(b => `
              <div class="donut-legend-row">
                <span class="flex items-center"><span class="legend-dot" style="background:${b.color}"></span>${b.label}</span>
                <span class="text-muted flex items-center gap-3">${b.pct}% (${b.count}) <span class="legend-view jump-tab" data-jump="flags">View</span></span>
              </div>`).join("")}
          </div>
        </div>
      </div>
      <div class="dpanel">
        <div class="flex items-center justify-between mb-2">
          <h5 class="text-xs uppercase tracking-wide text-neonsoft">Top Red Flags Found</h5>
          <button class="text-xs text-neonsoft hover:underline jump-tab" data-jump="flags">View All Red Flags <i data-lucide="arrow-right" class="w-3 h-3 inline"></i></button>
        </div>
        ${flags.length ? flags.slice(0, 3).map(f => `
          <div class="rf-row jump-tab" data-jump="flags">
            <div><div class="font-semibold text-sm">${f.clause || "Untitled clause"}</div><div class="text-xs text-muted">${f.why_risky || f.why || ""}</div></div>
            ${severityTag(f.severity)}
          </div>`).join("") : `<p class="text-sm text-muted py-4">No red flags detected in this document.</p>`}
      </div>`;

    // ---- Key points panel ----
    const pointsHtml = dataPoints.length
      ? `<div class="grid sm:grid-cols-2 gap-3">${dataPoints.map(d => ovCard("database", "bg-neon/15 text-neonsoft", d)).join("")}</div>`
      : emptyState("database", "No specific data points were listed.");

    // ---- Risks & clauses panel ----
    const clausesHtml = `
      ${keyRisks.length ? `<div class="mb-5"><h5 class="text-xs uppercase tracking-wide text-neonsoft mb-2.5">Key Risks</h5><div class="grid sm:grid-cols-2 gap-2.5">${keyRisks.map(k => ovCard("alert-circle", "bg-violet/15 text-violetsoft", k)).join("")}</div></div>` : ""}
      ${hidden.length ? `<div><h5 class="text-xs uppercase tracking-wide text-neonsoft mb-2.5">Hidden Clauses</h5><div class="grid sm:grid-cols-2 gap-2.5">${hidden.map(k => ovCard("eye-off", "bg-warning/15 text-warning", k)).join("")}</div></div>` : ""}
      ${(!keyRisks.length && !hidden.length) ? emptyState("file-warning", "No risky or hidden clauses were identified.") : ""}
    `;

    // ---- Your rights panel ----
    const rightsHtml = rights.length
      ? `<div class="grid sm:grid-cols-2 gap-3">${rights.map(r => ovCard("user-check", "bg-success/15 text-success", r)).join("")}</div>`
      : emptyState("user-check", "No specific user rights were called out.");

    // ---- Red flags panel ----
    const flagsHtml = flags.length ? flags.map(f => `
      <div class="redflag">
        <div class="rf-clause"><span class="rf-icon" data-lucide="alert-triangle"></span> ${f.clause || "Untitled clause"} ${severityTag(f.severity)}</div>
        <div class="rf-why">${f.why_risky || f.why || ""}</div>
      </div>`).join("") : emptyState("flag", "No red flags found — this document looks relatively clean.");

    // ---- Recommendations panel ----
    const recsHtml = recs.length
      ? recs.map(r => ovCard("check-circle-2", "bg-success/15 text-success", r)).join("")
      : emptyState("lightbulb", "No recommendations were generated.");

    // ---- Full report panel (plain text summary of everything) ----
    let reportHtml = `<div class="result-block"><h5>Summary</h5><p style="font-size:.85rem; line-height:1.6;">${data.summary || "—"}</p></div>`;
    reportHtml += listBlock("Key Risks", keyRisks);
    reportHtml += listBlock("Hidden Clauses", hidden);
    reportHtml += listBlock("Data Collected", dataPoints);
    reportHtml += listBlock("Your Rights", rights);
    reportHtml += listBlock("Recommendations", recs);

    const panels = { overview: overviewHtml, points: pointsHtml, clauses: clausesHtml, rights: rightsHtml, flags: flagsHtml, recs: recsHtml, report: reportHtml };
    const panelsHtml = Object.entries(panels).map(([id, html], i) => `<div class="dpanel-content${i === 0 ? "" : " hidden"}" data-panel="${id}">${html}</div>`).join("");

    container.innerHTML = statHtml + tabsHtml + panelsHtml;
    hydrateIcons();

    container.querySelectorAll(".dtab").forEach(btn => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".dtab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        container.querySelectorAll("[data-panel]").forEach(p => p.classList.add("hidden"));
        const panel = container.querySelector(`[data-panel="${btn.dataset.tab}"]`);
        if (panel) { panel.classList.remove("hidden"); panel.classList.add("fade-in"); }
      });
    });
    container.querySelectorAll(".jump-tab").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const target = container.querySelector(`.dtab[data-tab="${el.dataset.jump}"]`);
        if (target) target.click();
      });
    });
  }

  // ---------------- Generic analyzer wiring ----------------
  function wireAnalyzer({ dropId, fileId, pasteId, btnId, resultId, docType, getType }) {
    const drop = document.getElementById(dropId);
    const fileInput = document.getElementById(fileId);
    const paste = document.getElementById(pasteId);
    const btn = document.getElementById(btnId);
    const result = document.getElementById(resultId);
    if (!drop || !fileInput || !paste || !btn || !result) return;

    drop.addEventListener("click", () => fileInput.click());
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.style.borderColor = "var(--blue)"; });
    drop.addEventListener("dragleave", () => { drop.style.borderColor = ""; });
    drop.addEventListener("drop", e => {
      e.preventDefault();
      drop.style.borderColor = "";
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        drop.querySelector("h5").textContent = e.dataTransfer.files[0].name;
      }
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files.length) drop.querySelector("h5").textContent = fileInput.files[0].name;
    });

    btn.addEventListener("click", async () => {
      const type = getType ? getType() : docType;
      const formData = new FormData();
      formData.append("doc_type", type);
      if (fileInput.files.length) {
        formData.append("file", fileInput.files[0]);
      } else if (paste.value.trim()) {
        formData.append("text", paste.value.trim());
      } else {
        result.innerHTML = emptyState("alert-triangle", "Please upload a file or paste some text first.");
        hydrateIcons();
        return;
      }

      result.innerHTML = emptyState("search", "OMINI is analyzing your document...");
      hydrateIcons();

      try {
        const res = await fetch("/api/analyze", { method: "POST", body: formData });
        const data = await res.json();
        if (data.error) {
          result.innerHTML = emptyState("alert-triangle", data.message || ("Analysis failed: " + data.error));
          hydrateIcons();
          return;
        }
        renderAnalysis(result, data);
        refreshStats();
      } catch (e) {
        result.innerHTML = emptyState("alert-triangle", "Connection error. Please try again.");
        hydrateIcons();
      }
    });
  }

  safeRun("privacy analyzer", () => wireAnalyzer({
    dropId: "privacy-drop", fileId: "privacy-file", pasteId: "privacy-paste",
    btnId: "privacy-analyze-btn", resultId: "privacy-result", docType: "privacy_policy",
  }));

  safeRun("contract analyzer", () => wireAnalyzer({
    dropId: "contract-drop", fileId: "contract-file", pasteId: "contract-paste",
    btnId: "contract-analyze-btn", resultId: "contract-result",
    getType: () => document.querySelector('#section-contract .type-chip.active')?.dataset.ctype || "contract",
  }));

  safeRun("terms of service analyzer", () => wireAnalyzer({
    dropId: "policy-drop", fileId: "policy-file", pasteId: "policy-paste",
    btnId: "policy-analyze-btn", resultId: "policy-result", docType: "terms_of_service",
  }));

  safeRun("risk predictor", () => wireAnalyzer({
    dropId: "risk-drop", fileId: "risk-file", pasteId: "risk-paste",
    btnId: "risk-analyze-btn", resultId: "risk-result", docType: "other",
  }));

  safeRun("type chip toggles", () => {
    // Contract type chips
    document.querySelectorAll("#section-contract [data-ctype]").forEach(chip => {
      chip.addEventListener("click", () => {
        chip.parentElement.querySelectorAll("[data-ctype]").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
      });
    });
    
    // Policy mode chips
    document.querySelectorAll("#section-policy [data-mode]").forEach(chip => {
      chip.addEventListener("click", () => {
        chip.parentElement.querySelectorAll("[data-mode]").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
      });
    });

    // Risk focus chips
    document.querySelectorAll("#section-risk [data-rtype]").forEach(chip => {
      chip.addEventListener("click", () => {
        chip.parentElement.querySelectorAll("[data-rtype]").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
      });
    });
  });

  // ---------------- Courtroom ----------------
  safeRun("courtroom", () => {
    const courtBtn = document.getElementById("court-verdict-btn");
    if (!courtBtn) return;

    courtBtn.addEventListener("click", async () => {
      const title = document.getElementById("court-title").value || "Untitled Case";
      const plaintiff_story = document.getElementById("court-plaintiff").value;
      const defendant_story = document.getElementById("court-defendant").value;
      const evidence_notes = document.getElementById("court-evidence").value;
      const area = document.getElementById("court-verdict-area");

      if (!plaintiff_story || !defendant_story) {
        area.innerHTML = emptyState("alert-triangle", "Please fill in both the plaintiff's and defendant's accounts.");
        hydrateIcons();
        return;
      }

      area.innerHTML = emptyState("gavel", "OMINI is deliberating...");
      hydrateIcons();

      try {
        const res = await fetch("/api/courtroom/verdict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, plaintiff_story, defendant_story, evidence_notes }),
        });
        const data = await res.json();
        if (data.error) {
          area.innerHTML = emptyState("alert-triangle", data.message || ("Verdict failed: " + data.error));
          hydrateIcons();
          return;
        }

        const outcomeColor = {
          "Plaintiff Wins": "var(--success)",
          "Defendant Wins": "var(--blue-soft)",
          "Shared Responsibility": "var(--warning)",
          "Insufficient Evidence": "var(--muted)",
          "Mediation Recommended": "var(--purple-soft)",
        }[data.outcome] || "var(--text)";

        area.innerHTML = `
          <div class="verdict-card glass">
            <div class="verdict-outcome" style="color:${outcomeColor}">${data.outcome}</div>
            <div class="verdict-conf">Confidence: ${data.confidence}%</div>
            <div class="result-block"><h5>Reasoning</h5><p style="font-size:.88rem; line-height:1.65;">${data.reasoning}</p></div>
            ${listBlock("Evidence Used", data.evidence_used)}
            ${listBlock("Evidence Ignored / Missing", data.evidence_ignored_or_missing)}
            ${listBlock("Relevant Legal Principles", data.relevant_legal_principles)}
            ${data.bias_warning ? `<div class="result-block"><h5>Bias Warning</h5><p style="font-size:.82rem; color:var(--muted);">${data.bias_warning}</p></div>` : ""}
          </div>
        `;
        refreshStats();
      } catch (e) {
        area.innerHTML = emptyState("alert-triangle", "Connection error. Please try again.");
        hydrateIcons();
      }
    });
  });

  // ---------------- Saved documents list ----------------
  safeRun("saved documents", () => {
    function loadDocuments() {
      fetch("/api/documents").then(r => r.json()).then(docs => {
        const el = document.getElementById("saved-docs-list");
        if (!el || !docs.length) return;
        el.innerHTML = docs.map(d => {
          const risk = riskColor(d.danger_score || 0);
          return `<div class="activity-item">
            <div class="act-icon"><i data-lucide="file-text" class="w-4 h-4"></i></div>
            <div class="act-body">
              <div class="act-title">${d.filename} <span class="tag ${risk.cls}">${d.danger_score ?? 0}%</span></div>
              <div class="act-time">${d.doc_type} · ${d.created_at}</div>
            </div>
          </div>`;
        }).join("");
        hydrateIcons();
      }).catch(() => {});
    }
    loadDocuments();
    const savedNav = document.querySelector('.nav-item[data-section="saved"]');
    if (savedNav) savedNav.addEventListener("click", loadDocuments);
  });

  // ================ INTERACTIVE COURTROOM ================
  safeRun("courtroom interactive", () => {
    let courtSession = {
      stage: 1,
      caseTitle: "",
      messages: [],
      evidence: [],
      startTime: Date.now(),
      isListening: false,
      voiceEnabled: true // NEW: Track if voice is enabled
    };

    // Initialize courtroom robot
    let courtRobot = { setState: () => {}, speak: () => {} };
    try {
      if (window.OminiRobot) {
        courtRobot = OminiRobot.build("court-judge-robot") || courtRobot;
      }
    } catch (e) {
      /* robot loading failed, proceed without it */
    }

    const chatLog = document.getElementById("court-chat-log");
    const chatInput = document.getElementById("court-chat-input");
    const sendBtn = document.getElementById("court-send-btn");
    const micBtn = document.getElementById("court-mic-btn");
    const voiceToggleBtn = document.getElementById("court-voice-toggle"); // NEW
    const sessionTimer = document.getElementById("court-session-time");
    const judgeStatus = document.getElementById("court-judge-status");
    const thinkingDots = document.getElementById("court-thinking-dots");
    const caseSummary = document.getElementById("court-case-summary");
    const caseTitle = document.getElementById("court-case-title");
    const evidenceDrop = document.getElementById("court-evidence-drop");
    const evidenceFile = document.getElementById("court-evidence-file");
    const evidenceList = document.getElementById("court-evidence-list");

    // Session timer
    setInterval(() => {
      const elapsed = Math.floor((Date.now() - courtSession.startTime) / 1000);
      const hrs = Math.floor(elapsed / 3600);
      const mins = Math.floor((elapsed % 3600) / 60);
      const secs = elapsed % 60;
      sessionTimer.textContent = `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    }, 1000);

    // Add message to chat
    function addMessage(role, text, isTyping = false) {
      const msgEl = document.createElement("div");
      msgEl.className = role === "user" ? "flex justify-end" : "flex justify-start";
      
      const bubble = document.createElement("div");
      bubble.className = role === "user" 
        ? "max-w-xs bg-gradient-to-br from-neon to-violet text-bgdeep rounded-2xl rounded-br-none px-4 py-3 text-sm"
        : "max-w-xs bg-white/10 border border-hairline rounded-2xl rounded-bl-none px-4 py-3 text-sm";
      
      if (role === "omini") {
        const header = document.createElement("p");
        header.className = "text-neonsoft font-semibold text-xs mb-1";
        header.textContent = "OMINI Judge";
        bubble.appendChild(header);
      }

      const content = document.createElement("p");
      content.className = "text-ink";
      content.textContent = text;
      bubble.appendChild(content);
      
      msgEl.appendChild(bubble);
      chatLog.appendChild(msgEl);
      chatLog.scrollTop = chatLog.scrollHeight;
      
      courtSession.messages.push({ role, text, timestamp: new Date() });
      
      // Update case summary
      updateCaseSummary();
    }

    function setJudgeThinking(thinking) {
      if (thinking) {
        thinkingDots.classList.remove("hidden");
        judgeStatus.textContent = "Analyzing evidence...";
      } else {
        thinkingDots.classList.add("hidden");
        judgeStatus.textContent = "Ready to continue";
      }
    }

    function updateCaseSummary() {
      // Create a summary of the case so far
      const userMessages = courtSession.messages.filter(m => m.role === "user");
      const stageDescriptions = [
        "Case Title",
        "Your Statement",
        "Other Side Statement", 
        "Evidence",
        "Verdict"
      ];
      
      let summary = `<strong class="text-neon">Stage ${courtSession.stage}: ${stageDescriptions[courtSession.stage - 1]}</strong><br>`;
      summary += `<br><strong class="text-xs text-muted">Recent Activity:</strong><br>`;
      
      userMessages.slice(-2).forEach((msg, idx) => {
        const preview = msg.text.substring(0, 60) + (msg.text.length > 60 ? "..." : "");
        summary += `<div class="mt-2 pl-2 border-l-2 border-neon/30"><small>${preview}</small></div>`;
      });
      
      caseSummary.innerHTML = summary;
    }

    function updateStage(newStage) {
      courtSession.stage = newStage;
      document.querySelectorAll(".progress-stage").forEach(stage => {
        const stageNum = parseInt(stage.dataset.stage);
        stage.classList.remove("active");
        if (stageNum === newStage) {
          stage.classList.add("active");
        }
      });
    }

    // Text-to-Speech function for OMINI (shared engine — see voice.js)
    function speakResponse(text) {
      if (!courtSession.voiceEnabled) return;
      if (!window.OminiVoice || !window.OminiVoice.isSupported()) {
        judgeStatus.textContent = "Voice not supported";
        return;
      }
      window.OminiVoice.speak(text, {
        onStart: () => {
          judgeStatus.textContent = "Speaking...";
          try { courtRobot.setState("talking"); } catch (e) { /* */ }
        },
        onEnd: () => {
          judgeStatus.textContent = "Ready to continue";
          try { courtRobot.setState("idle"); } catch (e) { /* */ }
        },
        onError: () => {
          judgeStatus.textContent = "Ready to continue";
          try { courtRobot.setState("idle"); } catch (e) { /* */ }
        },
      });
    }

    async function sendCourtMessage() {
      const message = chatInput.value.trim();
      if (!message) return;

      // Update case title from first user message
      if (!courtSession.caseTitle && courtSession.stage === 1) {
        courtSession.caseTitle = message;
        caseTitle.value = `Case: ${message}`;
      }

      addMessage("user", message);
      chatInput.value = "";
      setJudgeThinking(true);
      
      // Update robot state
      try { courtRobot.setState("thinking"); } catch (e) { /* */ }

      try {
        const response = await fetch("/api/courtroom/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            stage: courtSession.stage,
            case_title: courtSession.caseTitle,
            conversation_history: courtSession.messages
          })
        });

        const data = await response.json();
        setJudgeThinking(false);
        
        // Update robot state
        try { courtRobot.setState("idle"); } catch (e) { /* */ }

        if (data.error) {
          addMessage("omini", data.message || NO_KEY_FALLBACK);
          return;
        }

        addMessage("omini", data.reply);
        
        // Speak the response
        speakResponse(data.reply);

        // Auto-advance stages based on responses
        if (data.next_stage) {
          updateStage(data.next_stage);
        }

        // Handle verdict
        if (data.is_verdict) {
          showVerdictCard(data.verdict);
        }
      } catch (e) {
        setJudgeThinking(false);
        try { courtRobot.setState("sad"); } catch (e) { /* */ }
        addMessage("omini", "Connection error. Please try again.");
      }
    }

    function showVerdictCard(verdict) {
      const verdictEl = document.createElement("div");
      verdictEl.className = "my-4 glass p-6 border-2 border-neon/30";
      
      // Handle cases where verdict is null or incomplete
      if (!verdict || !verdict.outcome) {
        verdictEl.innerHTML = `
          <div class="text-center mb-4">
            <p class="font-display text-lg text-neon mb-3">Session Complete</p>
            <p class="text-sm text-muted">OMINI has delivered their assessment. Review the conversation above for the full verdict.</p>
          </div>
        `;
      } else {
        verdictEl.innerHTML = `
          <div class="text-center mb-4">
            <div class="inline-block px-6 py-3 rounded-full bg-gradient-to-r from-neon/20 to-violet/20 border border-neon/50 mb-3">
              <p class="font-display text-2xl mb-1" style="color:${verdict.outcome_color || '#2fd8ff'};">${verdict.outcome}</p>
            </div>
            <p class="text-neonsoft text-sm font-semibold">Confidence: ${verdict.confidence || 'N/A'}%</p>
          </div>
          <div class="result-block"><h5>Reasoning</h5><p class="text-sm leading-relaxed">${verdict.reasoning || 'See conversation above'}</p></div>
          ${verdict.evidence_strength ? `<div class="result-block"><h5>Evidence Strength</h5><p class="text-sm">${verdict.evidence_strength}</p></div>` : ""}
          ${verdict.risk_score !== undefined ? `<div class="result-block"><h5>Risk Score</h5><p class="text-sm">${verdict.risk_score}/100</p></div>` : ""}
          ${verdict.next_steps ? `<div class="result-block"><h5>Recommended Next Steps</h5><p class="text-sm">${verdict.next_steps}</p></div>` : ""}
        `;
      }
      
      chatLog.appendChild(verdictEl);
      chatLog.scrollTop = chatLog.scrollHeight;
      
      // GSAP animation for verdict card entrance
      if (typeof gsap !== 'undefined') {
        gsap.from(verdictEl, {
          opacity: 0,
          y: 20,
          duration: 0.6,
          ease: "back.out"
        });
        
        // Animate the outcome text if it exists
        const outcomeEl = verdictEl.querySelector(".font-display");
        if (outcomeEl) {
          gsap.to(outcomeEl, {
            duration: 0.8,
            ease: "back.out",
            onStart: () => {
              gsap.set(outcomeEl, { scale: 0.8, opacity: 0 });
            }
          });
          
          gsap.to(outcomeEl, {
            scale: 1,
            opacity: 1,
            duration: 0.8,
            ease: "back.out",
            delay: 0.1
          });
        }
      }
    }

    // Evidence file handling
    evidenceDrop.addEventListener("click", () => evidenceFile.click());
    evidenceDrop.addEventListener("dragover", e => {
      e.preventDefault();
      evidenceDrop.style.borderColor = "var(--neon)";
    });
    evidenceDrop.addEventListener("dragleave", () => {
      evidenceDrop.style.borderColor = "";
    });
    evidenceDrop.addEventListener("drop", e => {
      e.preventDefault();
      evidenceDrop.style.borderColor = "";
      if (e.dataTransfer.files.length) {
        handleEvidenceFiles(e.dataTransfer.files);
      }
    });

    evidenceFile.addEventListener("change", () => {
      if (evidenceFile.files.length) {
        handleEvidenceFiles(evidenceFile.files);
      }
    });

    function handleEvidenceFiles(files) {
      Array.from(files).forEach(file => {
        if (!courtSession.evidence.find(f => f.name === file.name)) {
          courtSession.evidence.push(file);
          addEvidenceItem(file);
        }
      });
    }

    function addEvidenceItem(file) {
      const item = document.createElement("div");
      item.className = "flex items-center justify-between p-2 bg-white/5 rounded border border-hairline text-xs";
      item.innerHTML = `
        <div class="flex items-center gap-2 flex-1">
          <i data-lucide="file" class="w-3 h-3 text-neon flex-shrink-0"></i>
          <span class="truncate">${file.name}</span>
          <span class="text-muted">(${(file.size/1024/1024).toFixed(1)}MB)</span>
        </div>
        <button class="text-danger hover:text-danger/80" onclick="this.parentElement.remove()">
          <i data-lucide="x" class="w-3 h-3"></i>
        </button>
      `;
      
      if (evidenceList.textContent.includes("No files")) {
        evidenceList.innerHTML = "";
      }
      evidenceList.appendChild(item);
      hydrateIcons();
    }

    // Microphone button (shared push-to-talk engine — see voice.js)
    if (window.OminiVoice) {
      window.OminiVoice.attachPushToTalk(micBtn, {
        onStart: () => {
          courtSession.isListening = true;
          judgeStatus.textContent = "Listening...";
          if (typeof gsap !== 'undefined') {
            gsap.to(micBtn, { scale: 0.95, duration: 0.2 });
            gsap.fromTo(".waveform-line", { scaleY: 0.2 }, { scaleY: 1, duration: 0.1, repeat: -1, yoyo: true });
          }
        },
        onResult: (transcript) => {
          chatInput.value = transcript;
        },
        onError: () => { judgeStatus.textContent = "Microphone error"; },
        onEnd: () => {
          courtSession.isListening = false;
          judgeStatus.textContent = "Ready to continue";
          if (typeof gsap !== 'undefined') {
            gsap.to(micBtn, { scale: 1, duration: 0.2 });
            gsap.killTweensOf(".waveform-line");
          }
        },
      });
    }

    // Send button and Enter key
    sendBtn.addEventListener("click", sendCourtMessage);
    chatInput.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendCourtMessage();
      }
    });

    // Voice toggle button
    voiceToggleBtn.addEventListener("click", () => {
      courtSession.voiceEnabled = !courtSession.voiceEnabled;
      
      // Stop any speaking
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      
      // Update button appearance and tooltip
      if (courtSession.voiceEnabled) {
        voiceToggleBtn.classList.remove("text-muted");
        voiceToggleBtn.classList.add("text-neon");
        voiceToggleBtn.title = "OMINI voice: ON (click to mute)";
        voiceToggleBtn.innerHTML = '<i data-lucide="volume-2" class="w-4 h-4"></i>';
        judgeStatus.textContent = "Voice enabled ✓";
      } else {
        voiceToggleBtn.classList.remove("text-neon");
        voiceToggleBtn.classList.add("text-muted");
        voiceToggleBtn.title = "OMINI voice: OFF (click to unmute)";
        voiceToggleBtn.innerHTML = '<i data-lucide="volume-x" class="w-4 h-4"></i>';
        judgeStatus.textContent = "Voice muted";
      }
      
      hydrateIcons();
      
      console.log("[OMINI] Voice " + (courtSession.voiceEnabled ? "enabled" : "disabled"));
    });

    // End session button
    document.getElementById("court-end-btn").addEventListener("click", () => {
      if (confirm("End this courtroom session?")) {
        goToSection("home");
        courtSession = { stage: 1, caseTitle: "", messages: [], evidence: [], startTime: Date.now(), isListening: false };
        chatLog.innerHTML = '<div class="flex justify-start"><div class="max-w-xs bg-white/10 border border-hairline rounded-2xl rounded-bl-none px-4 py-3 text-sm"><p class="text-neonsoft font-semibold text-xs mb-1">OMINI Judge</p><p class="text-ink">Good morning! I\'m OMINI, your AI judge. Let\'s resolve this fairly and clearly. First, could you tell me the title of your case?</p></div></div>';
        caseTitle.value = "";
        chatInput.value = "";
        evidenceList.innerHTML = '<p class="text-muted">No files uploaded yet</p>';
        hydrateIcons();
      }
    });
  });

  // ---------------- Settings: edit profile ----------------
  safeRun("settings profile form", () => {
    const form = document.getElementById("settings-profile-form");
    const msg = document.getElementById("settings-profile-msg");
    const saveBtn = document.getElementById("settings-profile-save");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const full_name = document.getElementById("settings-full-name").value.trim();
      const username = document.getElementById("settings-username").value.trim();
      const email = document.getElementById("settings-email").value.trim();

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      msg.textContent = "";
      msg.className = "text-xs mt-2 mb-1";

      fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name, username, email }),
      })
        .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok) throw new Error(body.message || "Could not save changes.");

          msg.textContent = "Profile updated.";
          msg.classList.add("text-success");

          // Reflect changes across the dashboard without a reload
          const first = full_name.split(" ")[0] || full_name;
          const initial = full_name.charAt(0).toUpperCase();
          const greeting = document.getElementById("home-greeting-name");
          const avatarInitial = document.getElementById("profile-avatar-initial");
          const displayName = document.getElementById("profile-display-name");
          const displayUsername = document.getElementById("profile-display-username");
          const displayEmail = document.getElementById("profile-display-email");
          const accountEmail = document.getElementById("settings-account-email");

          if (greeting) greeting.textContent = first;
          if (avatarInitial) avatarInitial.textContent = initial;
          if (displayName) displayName.textContent = full_name;
          if (displayUsername) displayUsername.textContent = username;
          if (displayEmail) displayEmail.value = email;
          if (accountEmail) accountEmail.textContent = email;
        })
        .catch((err) => {
          msg.textContent = err.message || "Something went wrong.";
          msg.classList.add("text-danger");
        })
        .finally(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Changes";
        });
    });
  });

  // ---------------- Settings: change password ----------------
  safeRun("settings password form", () => {
    const form = document.getElementById("settings-password-form");
    const msg = document.getElementById("settings-password-msg");
    const saveBtn = document.getElementById("settings-password-save");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const currentInput = document.getElementById("settings-current-password");
      const newInput = document.getElementById("settings-new-password");
      const current_password = currentInput.value;
      const new_password = newInput.value;

      if (!new_password) {
        msg.textContent = "Enter a new password.";
        msg.className = "text-xs mt-2 mb-1 text-danger";
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Updating...";
      msg.textContent = "";
      msg.className = "text-xs mt-2 mb-1";

      fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password, new_password }),
      })
        .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok) throw new Error(body.message || "Could not update password.");
          msg.textContent = "Password updated.";
          msg.classList.add("text-success");
          currentInput.value = "";
          newInput.value = "";
        })
        .catch((err) => {
          msg.textContent = err.message || "Something went wrong.";
          msg.classList.add("text-danger");
        })
        .finally(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = "Update Password";
        });
    });
  });

  // ---------------- Community Court ----------------
  safeRun("community court", () => {
    const listView = document.getElementById("community-list-view");
    const detailView = document.getElementById("community-detail-view");
    const casesListEl = document.getElementById("community-cases-list");
    const newTitleInput = document.getElementById("community-new-title");
    const newBtn = document.getElementById("community-new-btn");
    const newMsg = document.getElementById("community-new-msg");
    if (!listView || !detailView || !casesListEl) return;

    const myUserId = window.OMINI_USER_ID;
    let communityRobot = { setState: () => {}, speak: () => {} };
    let robotBuilt = false;
    let activeCaseId = null;
    let pollTimer = null;
    let lastMessageCount = -1;
    let voiceEnabled = true; // NEW: OMINI voice for Community Court, same engine as the Practice Courtroom
    let spokenMessageIds = new Set();
    let voiceBaselineSet = false;

    const judgeStatusEl2 = () => document.getElementById("community-judge-status");

    // Text-to-Speech for OMINI in Community Court (shared engine — see voice.js)
    function speakCommunityMessage(text) {
      if (!voiceEnabled) return;
      if (!window.OminiVoice || !window.OminiVoice.isSupported()) return;
      window.OminiVoice.speak(text, {
        onStart: () => {
          const el = judgeStatusEl2();
          if (el) el.textContent = "Speaking...";
          try { communityRobot.setState("talking"); } catch (e) { /* */ }
        },
        onEnd: () => {
          try { communityRobot.setState("idle"); } catch (e) { /* */ }
        },
        onError: () => {
          try { communityRobot.setState("idle"); } catch (e) { /* */ }
        },
      });
    }

    // Speak any newly-arrived OMINI messages since the last poll. The chat log
    // is rebuilt wholesale on each poll, so we track already-spoken message ids
    // rather than relying on array position. On first load of a case we set a
    // baseline instead of reading the whole history aloud.
    function maybeSpeakNewMessages(messages) {
      if (!voiceBaselineSet) {
        messages.forEach(m => spokenMessageIds.add(m.id));
        voiceBaselineSet = true;
        return;
      }
      messages
        .filter(m => m.sender_type === "ai" && !spokenMessageIds.has(m.id))
        .forEach(m => {
          spokenMessageIds.add(m.id);
          speakCommunityMessage(m.content);
        });
    }

    function ensureRobot() {
      if (robotBuilt) return;
      robotBuilt = true;
      if (window.OminiRobot) communityRobot = OminiRobot.build("community-judge-robot") || communityRobot;
    }

    function statusBadge(status) {
      const map = {
        setup: ["badge-neutral", "Setting Up"],
        awaiting_defendant: ["badge-warning", "Awaiting Defendant"],
        gathering: ["badge-warning", "Gathering Witnesses"],
        hearing: ["badge-premium", "Live Hearing"],
        closed: ["badge-success", "Closed"],
        declined: ["badge-danger", "Declined"],
      };
      return map[status] || ["badge-neutral", status];
    }

    function participantStatusChip(status) {
      const map = { pending: ["badge-warning", "Pending"], accepted: ["badge-success", "Joined"], declined: ["badge-danger", "Declined"] };
      const m = map[status] || ["badge-neutral", status];
      return `<span class="badge ${m[0]}">${m[1]}</span>`;
    }

    function roleLabel(p) {
      if (p.role === "victim") return "Victim / Plaintiff";
      if (p.role === "defendant") return "Defendant";
      return `Witness (${p.side === "victim" ? "victim's" : "defendant's"} side)`;
    }

    // ---- List view ----
    function renderCasesList(cases) {
      if (!cases.length) {
        casesListEl.innerHTML = emptyState("gavel", "No community cases yet. Start one above.");
        hydrateIcons();
        return;
      }
      casesListEl.innerHTML = cases.map(c => {
        const [cls, label] = statusBadge(c.status);
        const other = c.my_role === "victim" ? (c.defendant_name || "no defendant yet") : (c.victim_name || "—");
        return `
          <div class="p-3.5 rounded-xl border border-hairline bg-white/5 hover:bg-white/10 hover:border-hairlinestrong cursor-pointer transition-colors flex items-center justify-between gap-3 community-case-row" data-case-id="${c.id}">
            <div class="min-w-0">
              <div class="font-semibold text-sm truncate">${c.title}</div>
              <div class="text-xs text-muted truncate">You: ${c.my_role} · vs ${other}</div>
            </div>
            <span class="badge ${cls} flex-shrink-0">${label}</span>
          </div>`;
      }).join("");
      hydrateIcons();
      casesListEl.querySelectorAll(".community-case-row").forEach(row => {
        row.addEventListener("click", () => openCase(parseInt(row.dataset.caseId, 10)));
      });
    }

    function loadCasesList() {
      fetch("/api/community/cases").then(r => r.json()).then(renderCasesList).catch(() => {});
    }

    if (newBtn) {
      newBtn.addEventListener("click", () => {
        const title = newTitleInput.value.trim();
        if (!title) { newMsg.textContent = "Give your case a title first."; newMsg.className = "text-xs mt-2 text-danger"; return; }
        newBtn.disabled = true;
        fetch("/api/community/cases", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }).then(r => r.json().then(body => ({ ok: r.ok, body })))
          .then(({ ok, body }) => {
            if (!ok) throw new Error(body.message || "Could not create case.");
            newTitleInput.value = "";
            newMsg.textContent = "";
            openCase(body.case.id);
          })
          .catch(err => { newMsg.textContent = err.message; newMsg.className = "text-xs mt-2 text-danger"; })
          .finally(() => { newBtn.disabled = false; });
      });
      newTitleInput.addEventListener("keydown", e => { if (e.key === "Enter") newBtn.click(); });
    }

    // ---- Detail view ----
    function openCase(id) {
      activeCaseId = id;
      lastMessageCount = -1;
      spokenMessageIds = new Set();
      voiceBaselineSet = false;
      if (window.OminiVoice) window.OminiVoice.cancel();
      listView.classList.add("hidden");
      detailView.classList.remove("hidden");
      ensureRobot();
      fetchDetail();
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(fetchDetail, 4000);
    }

    function closeCase() {
      activeCaseId = null;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      if (window.OminiVoice) window.OminiVoice.cancel();
      detailView.classList.add("hidden");
      listView.classList.remove("hidden");
      loadCasesList();
    }

    const backBtn = document.getElementById("community-back-btn");
    if (backBtn) backBtn.addEventListener("click", closeCase);

    function fetchDetail() {
      if (!activeCaseId) return;
      fetch(`/api/community/cases/${activeCaseId}`).then(r => {
        if (r.status === 404) { closeCase(); return null; }
        return r.json();
      }).then(data => { if (data) renderDetail(data); }).catch(() => {});
    }

    function renderDetail(data) {
      const { case: c, participants, messages, evidence, me, is_my_turn } = data;

      document.getElementById("community-case-title").textContent = c.title;
      const [badgeCls, badgeLabel] = statusBadge(c.status);
      const badgeEl = document.getElementById("community-status-badge");
      badgeEl.className = "badge " + badgeCls;
      badgeEl.textContent = badgeLabel;

      const subMap = {
        setup: "Add the other party to get this session moving.",
        awaiting_defendant: "Waiting for the defendant to accept the invite.",
        gathering: "Add witnesses, then begin the hearing when you're ready.",
        hearing: `Hearing in progress — ${c.stage === "statements" ? "collecting statements" : c.stage === "evidence" ? "collecting evidence" : c.stage === "questions" ? "OMINI is asking questions" : "wrapping up"}.`,
        closed: "This case is closed.",
        declined: "This case was declined and is now closed.",
      };
      document.getElementById("community-case-sub").textContent = subMap[c.status] || "";

      const judgeStatusEl = document.getElementById("community-judge-status");
      if (c.status === "hearing" && c.stage !== "verdict") {
        judgeStatusEl.textContent = is_my_turn ? "It's your turn to speak." : "Listening...";
        communityRobot.setState(is_my_turn ? "listening" : "talking");
      } else if (c.stage === "verdict") {
        judgeStatusEl.textContent = "Verdict delivered.";
        communityRobot.setState("happy");
      } else {
        judgeStatusEl.textContent = subMap[c.status] || "Waiting...";
        communityRobot.setState("idle");
      }

      // ---- Participants ----
      const partsEl = document.getElementById("community-participants-list");
      partsEl.innerHTML = participants.map(p => `
        <div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/5">
          <div class="min-w-0"><div class="font-medium truncate">${p.full_name}${p.user_id === myUserId ? " (you)" : ""}</div><div class="text-muted text-[11px]">${roleLabel(p)}</div></div>
          ${participantStatusChip(p.status)}
        </div>`).join("") || emptyState("users", "No participants yet.");

      // ---- My pending invite card ----
      const inviteCard = document.getElementById("community-my-invite-card");
      if (me && me.status === "pending") {
        inviteCard.classList.remove("hidden");
        document.getElementById("community-my-invite-text").textContent =
          `You've been asked to join "${c.title}" as ${roleLabel(me).toLowerCase()}. Would you like to take part?`;
      } else {
        inviteCard.classList.add("hidden");
      }

      // ---- Add defendant ----
      const addDefendantCard = document.getElementById("community-add-defendant-card");
      if (me && me.role === "victim" && c.status === "setup") addDefendantCard.classList.remove("hidden");
      else addDefendantCard.classList.add("hidden");

      // ---- Add witness ----
      const addWitnessCard = document.getElementById("community-add-witness-card");
      const canAddWitness = me && me.status === "accepted" && (me.role === "victim" || me.role === "defendant") &&
        !["setup", "declined", "closed"].includes(c.status);
      if (canAddWitness) {
        addWitnessCard.classList.remove("hidden");
        const mySide = me.role;
        const count = participants.filter(p => p.role === "witness" && p.side === mySide && p.status !== "declined").length;
        document.getElementById("community-witness-count").textContent = `(${count}/3)`;
        document.getElementById("community-witness-invite-btn").disabled = count >= 3;
      } else {
        addWitnessCard.classList.add("hidden");
      }

      // ---- Begin hearing ----
      const beginBtnEl = document.getElementById("community-begin-btn");
      if (me && me.role === "victim" && c.status === "gathering") beginBtnEl.classList.remove("hidden");
      else beginBtnEl.classList.add("hidden");

      // ---- Evidence ----
      const evCard = document.getElementById("community-evidence-card");
      const evAction = document.getElementById("community-evidence-action");
      if (c.status === "hearing" && c.stage === "evidence" && me && me.status === "accepted") {
        evCard.classList.remove("hidden");
        if (me.evidence_status === "pending") evAction.classList.remove("hidden");
        else evAction.classList.add("hidden");
      } else if (evidence.length) {
        evCard.classList.remove("hidden");
        evAction.classList.add("hidden");
      } else {
        evCard.classList.add("hidden");
      }
      const evListEl = document.getElementById("community-evidence-list");
      evListEl.innerHTML = evidence.length
        ? evidence.map(e => `<div class="p-2 rounded-lg bg-white/5"><span class="font-medium">${e.full_name}:</span> ${e.note || e.filename || "submitted evidence"}</div>`).join("")
        : `<p class="text-muted">No evidence submitted yet.</p>`;

      // ---- Chat log ----
      const chatLog = document.getElementById("community-chat-log");
      if (messages.length !== lastMessageCount) {
        maybeSpeakNewMessages(messages);
        chatLog.innerHTML = messages.map(m => {
          if (m.sender_type === "ai") {
            return `<div class="flex justify-start"><div class="max-w-xs bg-white/10 border border-hairline rounded-2xl rounded-bl-none px-4 py-3 text-sm"><p class="text-neonsoft font-semibold text-xs mb-1">OMINI</p><p class="text-ink">${m.content}</p></div></div>`;
          }
          if (m.sender_type === "system") {
            return `<div class="text-center text-[11px] text-muted py-1">${m.content}</div>`;
          }
          const mine = m.user_id === myUserId;
          return `<div class="flex ${mine ? "justify-end" : "justify-start"}">
            <div class="max-w-xs ${mine ? "bg-gradient-to-br from-neon/20 to-violet/20 border border-neon/30 rounded-br-none" : "bg-white/10 border border-hairline rounded-bl-none"} rounded-2xl px-4 py-3 text-sm">
              <p class="text-neonsoft font-semibold text-xs mb-1">${m.display_name || "Participant"}</p>
              <p class="text-ink">${m.content}</p>
            </div></div>`;
        }).join("");
        chatLog.scrollTop = chatLog.scrollHeight;
        lastMessageCount = messages.length;
      }

      // ---- Chat input / turn ----
      const chatInput = document.getElementById("community-chat-input");
      const sendBtnEl = document.getElementById("community-send-btn");
      const declineAnswerBtnEl = document.getElementById("community-decline-answer-btn");
      const turnBanner = document.getElementById("community-turn-banner");
      const canType = c.status === "hearing" && ["statements", "questions"].includes(c.stage) && is_my_turn;
      chatInput.disabled = !canType;
      sendBtnEl.disabled = !canType;
      if (canType) {
        turnBanner.classList.add("hidden");
      } else if (c.status === "hearing" && ["statements", "questions"].includes(c.stage)) {
        turnBanner.classList.remove("hidden");
        turnBanner.textContent = "Waiting for the other party to respond...";
      } else {
        turnBanner.classList.add("hidden");
      }
      if (c.stage === "questions" && is_my_turn) declineAnswerBtnEl.classList.remove("hidden");
      else declineAnswerBtnEl.classList.add("hidden");

      // ---- Verdict ----
      const verdictBox = document.getElementById("community-verdict-box");
      if (c.verdict) {
        verdictBox.classList.remove("hidden");
        verdictBox.innerHTML = `<h4 class="font-semibold text-sm mb-2 flex items-center gap-1.5"><i data-lucide="scale" class="w-4 h-4 text-neon"></i> OMINI's Verdict</h4><p class="text-sm text-ink whitespace-pre-line">${c.verdict}</p>`;
      } else {
        verdictBox.classList.add("hidden");
      }

      hydrateIcons();
    }

    // ---- Actions ----
    const inviteCardEl = document.getElementById("community-my-invite-card");
    if (inviteCardEl) inviteCardEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-respond]");
      if (!btn || !activeCaseId) return;
      fetch(`/api/community/cases/${activeCaseId}/respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: btn.dataset.respond }),
      }).then(() => fetchDetail()).catch(() => {});
    });

    const defendantBtn = document.getElementById("community-defendant-invite-btn");
    if (defendantBtn) defendantBtn.addEventListener("click", () => {
      const email = document.getElementById("community-defendant-email").value.trim();
      const msg = document.getElementById("community-defendant-msg");
      if (!email) return;
      fetch(`/api/community/cases/${activeCaseId}/invite`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: "defendant" }),
      }).then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok) throw new Error(body.message || "Could not send invite.");
          msg.textContent = "Defendant notified."; msg.className = "text-xs mt-2 text-success";
          document.getElementById("community-defendant-email").value = "";
          fetchDetail();
        })
        .catch(err => { msg.textContent = err.message; msg.className = "text-xs mt-2 text-danger"; });
    });

    const witnessBtn = document.getElementById("community-witness-invite-btn");
    if (witnessBtn) witnessBtn.addEventListener("click", () => {
      const email = document.getElementById("community-witness-email").value.trim();
      const msg = document.getElementById("community-witness-msg");
      if (!email) return;
      fetch(`/api/community/cases/${activeCaseId}/invite`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: "witness" }),
      }).then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok) throw new Error(body.message || "Could not send invite.");
          msg.textContent = "Witness notified."; msg.className = "text-xs mt-2 text-success";
          document.getElementById("community-witness-email").value = "";
          fetchDetail();
        })
        .catch(err => { msg.textContent = err.message; msg.className = "text-xs mt-2 text-danger"; });
    });

    const beginBtn = document.getElementById("community-begin-btn");
    if (beginBtn) beginBtn.addEventListener("click", () => {
      beginBtn.disabled = true;
      fetch(`/api/community/cases/${activeCaseId}/begin`, { method: "POST" })
        .then(() => fetchDetail())
        .finally(() => { beginBtn.disabled = false; });
    });

    function sendCommunityMessage() {
      const input = document.getElementById("community-chat-input");
      const msg = input.value.trim();
      if (!msg || !activeCaseId || input.disabled) return;
      input.value = "";
      fetch(`/api/community/cases/${activeCaseId}/message`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      }).then(() => fetchDetail()).catch(() => {});
    }
    const sendBtn = document.getElementById("community-send-btn");
    if (sendBtn) sendBtn.addEventListener("click", sendCommunityMessage);
    const chatInputEl = document.getElementById("community-chat-input");
    if (chatInputEl) chatInputEl.addEventListener("keydown", e => { if (e.key === "Enter") sendCommunityMessage(); });

    const declineAnswerBtn = document.getElementById("community-decline-answer-btn");
    if (declineAnswerBtn) declineAnswerBtn.addEventListener("click", () => {
      fetch(`/api/community/cases/${activeCaseId}/decline_answer`, { method: "POST" }).then(() => fetchDetail());
    });

    // Voice toggle — same OMINI voice engine and UX as the Practice Courtroom
    const communityVoiceToggleBtn = document.getElementById("community-voice-toggle");
    if (communityVoiceToggleBtn) {
      communityVoiceToggleBtn.addEventListener("click", () => {
        voiceEnabled = !voiceEnabled;
        if (window.OminiVoice) window.OminiVoice.cancel();
        if (voiceEnabled) {
          communityVoiceToggleBtn.classList.remove("text-muted");
          communityVoiceToggleBtn.classList.add("text-neon");
          communityVoiceToggleBtn.title = "OMINI voice: ON (click to mute)";
          communityVoiceToggleBtn.innerHTML = '<i data-lucide="volume-2" class="w-4 h-4"></i>';
        } else {
          communityVoiceToggleBtn.classList.remove("text-neon");
          communityVoiceToggleBtn.classList.add("text-muted");
          communityVoiceToggleBtn.title = "OMINI voice: OFF (click to unmute)";
          communityVoiceToggleBtn.innerHTML = '<i data-lucide="volume-x" class="w-4 h-4"></i>';
        }
        hydrateIcons();
      });
    }

    // Mic button — hold to speak, same engine as the Practice Courtroom
    const communityMicBtn = document.getElementById("community-mic-btn");
    if (communityMicBtn && window.OminiVoice) {
      window.OminiVoice.attachPushToTalk(communityMicBtn, {
        isDisabled: () => chatInputEl.disabled,
        onStart: () => {
          const el = judgeStatusEl2();
          if (el) el.textContent = "Listening...";
          if (typeof gsap !== 'undefined') gsap.to(communityMicBtn, { scale: 0.95, duration: 0.2 });
        },
        onResult: (transcript) => { chatInputEl.value = transcript; },
        onError: () => {
          const el = judgeStatusEl2();
          if (el) el.textContent = "Microphone error";
        },
        onEnd: () => {
          if (typeof gsap !== 'undefined') gsap.to(communityMicBtn, { scale: 1, duration: 0.2 });
        },
      });
    }

    // Evidence upload
    let pendingEvidenceFile = null;
    const evDrop = document.getElementById("community-evidence-drop");
    const evFileInput = document.getElementById("community-evidence-file");
    if (evDrop && evFileInput) {
      evDrop.addEventListener("click", () => evFileInput.click());
      evFileInput.addEventListener("change", () => {
        if (evFileInput.files.length) {
          pendingEvidenceFile = evFileInput.files[0];
          document.getElementById("community-evidence-filename").textContent = pendingEvidenceFile.name;
        }
      });
    }
    const evSubmitBtn = document.getElementById("community-evidence-submit-btn");
    if (evSubmitBtn) evSubmitBtn.addEventListener("click", () => {
      const note = document.getElementById("community-evidence-note").value.trim();
      const fd = new FormData();
      if (pendingEvidenceFile) fd.append("file", pendingEvidenceFile);
      if (note) fd.append("note", note);
      fetch(`/api/community/cases/${activeCaseId}/evidence`, { method: "POST", body: fd })
        .then(() => { pendingEvidenceFile = null; document.getElementById("community-evidence-note").value = ""; fetchDetail(); });
    });
    const evDeclineBtn = document.getElementById("community-evidence-decline-btn");
    if (evDeclineBtn) evDeclineBtn.addEventListener("click", () => {
      const fd = new FormData();
      fd.append("decline", "true");
      fetch(`/api/community/cases/${activeCaseId}/evidence`, { method: "POST", body: fd }).then(() => fetchDetail());
    });

    loadCasesList();
  });

  // ---------------- Notifications (Community Court invites) ----------------
  function loadNotifications() {
    fetch("/api/community/notifications").then(r => r.json()).then(rows => {
      const badge = document.getElementById("notif-badge");
      if (badge) {
        if (rows.length) { badge.textContent = rows.length; badge.classList.remove("hidden"); }
        else badge.classList.add("hidden");
      }
      const listEl = document.getElementById("notifications-list");
      if (!listEl) return;
      if (!rows.length) {
        listEl.innerHTML = `<div class="text-center py-16 px-5 text-muted"><i data-lucide="bell" class="w-9 h-9 mx-auto mb-3 opacity-70"></i><p>You're all caught up.</p></div>`;
        hydrateIcons();
        return;
      }
      listEl.innerHTML = rows.map(n => `
        <div class="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-hairline bg-white/5 mb-2.5">
          <div class="min-w-0">
            <div class="font-semibold text-sm truncate">${n.title}</div>
            <div class="text-xs text-muted truncate">${n.invited_by_name || "Someone"} invited you as a ${n.role}</div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <button class="btn-primary btn-sm notif-respond" data-case="${n.case_id}" data-response="accept">Accept</button>
            <button class="btn-danger btn-sm notif-respond" data-case="${n.case_id}" data-response="decline">Decline</button>
          </div>
        </div>`).join("");
      hydrateIcons();
      listEl.querySelectorAll(".notif-respond").forEach(btn => {
        btn.addEventListener("click", () => {
          btn.closest(".flex.items-center").style.opacity = "0.5";
          fetch(`/api/community/cases/${btn.dataset.case}/respond`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response: btn.dataset.response }),
          }).then(() => loadNotifications()).catch(() => {});
        });
      });
    }).catch(() => {});
  }
  safeRun("notifications", loadNotifications);

});