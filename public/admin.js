/* Store Council — central (platform owner) panel */
"use strict";

let token = localStorage.getItem("sc_admin_token") || "";
const $app = document.getElementById("app");

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401) {
    token = "";
    localStorage.removeItem("sc_admin_token");
    render();
    throw new Error("Unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function loginView(isSetup) {
  $app.innerHTML = `
  <div class="auth-wrap"><div class="card auth-card">
    <h1>Central Panel</h1>
    <p class="sub">Platform administration — stores, plans, agents.${isSetup ? "<br>First run: create the admin password (min 10 chars)." : ""}</p>
    <label>Admin password</label>
    <input type="password" id="pw" autofocus />
    <div id="msg"></div>
    <button id="go" style="width:100%;margin-top:14px">${isSetup ? "Create" : "Log in"}</button>
  </div></div>`;
  const submit = async () => {
    try {
      const r = await api(isSetup ? "/admin/auth/setup" : "/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: document.getElementById("pw").value }),
      });
      token = r.token;
      localStorage.setItem("sc_admin_token", token);
      render();
    } catch (err) {
      document.getElementById("msg").innerHTML = `<div class="notice err">${esc(err.message)}</div>`;
    }
  };
  document.getElementById("go").onclick = submit;
  document.getElementById("pw").onkeydown = (e) => { if (e.key === "Enter") submit(); };
}

async function panelView() {
  const o = await api("/admin/overview");
  const p = o.platform;
  $app.innerHTML = `
  <main class="main" style="margin:0 auto">
    <div class="row" style="justify-content:space-between">
      <h1 class="fit">Central Panel</h1>
      <button class="ghost small fit" id="logout">Log out</button>
    </div>
    <p class="sub">Platform owner view — the merchant dashboard is at <a href="/">/</a></p>

    <div class="stat-row">
      <div class="stat"><div class="v">${esc(o.store.name || (o.store.connected ? "connected" : "—"))}</div><div class="k">Store ${esc(o.store.domain)}</div></div>
      <div class="stat"><div class="v">${esc(p.plan)}</div><div class="k">Plan</div></div>
      <div class="stat"><div class="v" style="color:${p.status === "locked" ? "var(--danger)" : "var(--accent)"}">${esc(p.status)}</div><div class="k">Status</div></div>
      <div class="stat"><div class="v">${o.counts.reports}</div><div class="k">Reports</div></div>
      <div class="stat"><div class="v">${o.counts.actionsDone}/${o.counts.actions}</div><div class="k">Actions done</div></div>
      <div class="stat"><div class="v">${o.counts.pendingChanges}</div><div class="k">Pending changes</div></div>
      <div class="stat"><div class="v">${o.counts.pendingQuestions}</div><div class="k">Open questions</div></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Salla App URL (merchant controls in-Salla)</h2>
      <p class="sub">Paste this as the app's <strong>App URL</strong> in the Salla Partners portal. The merchant then runs and controls Store Council entirely inside their Salla dashboard — no external site. ${o.embedUrl ? "" : "(Available once the merchant completes first-run setup.)"}</p>
      ${o.embedUrl ? `<input type="text" readonly value="${esc(o.embedUrl)}" onclick="this.select()" />` : ""}
    </div>

    <div class="card">
      <h2 style="margin-top:0">Tenant management</h2>
      <div class="row">
        <div>
          <label>Plan</label>
          <select id="plan">${["trial", "basic", "pro", "growth", "custom"].map((x) =>
            `<option value="${x}" ${p.plan === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        </div>
        <div>
          <label>Status</label>
          <select id="status">
            <option value="active" ${p.status === "active" ? "selected" : ""}>active</option>
            <option value="locked" ${p.status === "locked" ? "selected" : ""}>locked (suspends merchant dashboard)</option>
          </select>
        </div>
      </div>
      <label>Operator notes</label>
      <textarea id="notes">${esc(p.notes)}</textarea>
      <div class="row" style="margin-top:12px">
        <button class="fit" id="saveBtn">Save</button>
        <div class="fit" id="saveMsg"></div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Health</h2>
      <span class="badge ${o.merchantSetup ? "" : "warn"}">merchant setup: ${o.merchantSetup ? "✓" : "—"}</span>
      <span class="badge ${o.store.connected ? "" : "off"}">salla: ${o.store.connected ? "✓ " + esc(o.store.mode || "") : "not connected"}</span>
      <span class="badge ${o.aiConfigured ? "" : "off"}">AI (${esc(o.provider)}): ${o.aiConfigured ? "✓" : "no key"}</span>
      <span class="badge ${o.analysisRunning ? "warn" : ""}">analysis: ${o.analysisRunning ? "running" : "idle"}</span>
      <span class="badge">curator: ${esc(o.curator.lastRunAt ? o.curator.lastRunAt.slice(0, 10) : "never")}</span>
      <div class="row" style="margin-top:12px">
        <button class="ghost small fit" id="curatorBtn">Run curator now</button>
        <div class="fit" id="curatorMsg"></div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Agent fleet</h2>
      <table style="width:100%;border-collapse:collapse;font-size:0.88rem">
        <tr><th style="text-align:start;padding:4px">Agent</th><th>Enabled</th><th>Write mode</th><th>Memories</th></tr>
        ${o.agents.map((a) => `
          <tr style="border-top:1px solid var(--line)">
            <td style="padding:4px">${esc(a.name)} <span class="sub">(${esc(a.id)})</span></td>
            <td style="text-align:center">${a.enabled ? "✓" : "—"}</td>
            <td style="text-align:center">${esc(a.writeMode)}</td>
            <td style="text-align:center">${a.memories}</td>
          </tr>`).join("")}
      </table>
    </div>
  </main>`;

  document.getElementById("logout").onclick = async () => {
    try { await api("/admin/auth/logout", { method: "POST" }); } catch {}
    token = "";
    localStorage.removeItem("sc_admin_token");
    render();
  };
  document.getElementById("saveBtn").onclick = async () => {
    try {
      await api("/admin/platform", {
        method: "PUT",
        body: JSON.stringify({
          plan: document.getElementById("plan").value,
          status: document.getElementById("status").value,
          notes: document.getElementById("notes").value,
        }),
      });
      panelView();
    } catch (err) {
      document.getElementById("saveMsg").innerHTML = `<div class="notice err">${esc(err.message)}</div>`;
    }
  };
  document.getElementById("curatorBtn").onclick = async (e) => {
    e.target.disabled = true;
    try {
      const { summary } = await api("/admin/curator/run", { method: "POST" });
      document.getElementById("curatorMsg").innerHTML = `<span class="sub">${esc(summary)}</span>`;
    } catch (err) {
      document.getElementById("curatorMsg").innerHTML = `<div class="notice err">${esc(err.message)}</div>`;
    }
    e.target.disabled = false;
  };
}

async function render() {
  let status;
  try {
    status = await fetch("/admin/auth/status", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then((r) => r.json());
  } catch {
    $app.innerHTML = `<div class="auth-wrap"><div class="card auth-card"><p>Server unreachable.</p></div></div>`;
    return;
  }
  if (!status.setup) return loginView(true);
  if (!status.authenticated) return loginView(false);
  try {
    await panelView();
  } catch (err) {
    if (err.message !== "Unauthorized") {
      $app.innerHTML = `<div class="auth-wrap"><div class="notice err">${esc(err.message)}</div></div>`;
    }
  }
}

render();
