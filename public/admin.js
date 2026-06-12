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

    ${o.fleet ? `
    <div class="card">
      <h2 style="margin-top:0">Fleet monitoring</h2>
      <span class="badge ${Number(o.fleet.queue.queued) > 0 ? "warn" : ""}">queue: ${esc(o.fleet.queue.queued)} queued / ${esc(o.fleet.queue.running)} running</span>
      <span class="badge ${Number(o.fleet.queue.oldest_due_min) > 30 ? "off" : ""}">oldest due: ${esc(o.fleet.queue.oldest_due_min)} min</span>
      <span class="badge ${Number(o.fleet.queue.failed_24h) > 0 ? "off" : ""}">failed 24h: ${esc(o.fleet.queue.failed_24h)}</span>
      <span class="badge">tokens today: ${(Number(o.fleet.tokensToday) / 1e6).toFixed(2)}M</span>
      ${Object.entries(o.fleet.tenantsByStatus).map(([s, n]) => `<span class="badge">${esc(s)}: ${esc(n)}</span>`).join(" ")}
    </div>
    <div class="card">
      <h2 style="margin-top:0">Tenants</h2>
      <div id="tenantList">…</div>
    </div>` : ""}

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

  if (o.fleet) {
    const list = document.getElementById("tenantList");
    const { tenants } = await api("/admin/tenants");
    list.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
        <tr><th style="text-align:start;padding:4px">Merchant</th><th>Status</th><th>Plan</th><th>Msgs/mo</th><th>Tokens/mo</th><th>Fails 24h</th><th>Actions</th></tr>
        ${tenants.map((s) => `
        <tr style="border-top:1px solid var(--line)" data-tid="${esc(s.id)}">
          <td style="padding:4px">${esc(s.name || s.salla_merchant_id || s.id.slice(0, 8))}</td>
          <td style="text-align:center"><span class="badge ${s.status === "locked" || s.status === "uninstalled" ? "off" : ""}">${esc(s.status)}</span></td>
          <td style="text-align:center">
            <select class="tPlan" style="width:auto;padding:2px 6px">${["trial", "basic", "pro", "growth", "custom"].map((p) =>
              `<option value="${p}" ${s.plan === p ? "selected" : ""}>${p}</option>`).join("")}</select>
          </td>
          <td style="text-align:center">${esc(s.msgs_month)}</td>
          <td style="text-align:center">${(Number(s.tokens_month) / 1e6).toFixed(2)}M</td>
          <td style="text-align:center">${esc(s.failed_24h)}</td>
          <td style="text-align:center;white-space:nowrap">
            <button class="small ghost" data-act="lock">${s.status === "locked" ? "unlock" : "lock"}</button>
            <button class="small ghost" data-act="imp">support</button>
            ${s.status === "uninstalled" ? `<button class="small ghost danger" data-act="purge">purge</button>` : ""}
          </td>
        </tr>`).join("")}
      </table>`;
    list.querySelectorAll("select.tPlan").forEach((sel) => {
      sel.onchange = async () => {
        await api(`/admin/tenants/${sel.closest("tr").dataset.tid}`, {
          method: "PUT", body: JSON.stringify({ plan: sel.value }),
        });
        panelView();
      };
    });
    list.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.onclick = async () => {
        const tid = btn.closest("tr").dataset.tid;
        if (btn.dataset.act === "lock") {
          const row = tenants.find((x) => x.id === tid);
          await api(`/admin/tenants/${tid}`, {
            method: "PUT",
            body: JSON.stringify({ status: row.status === "locked" ? "active" : "locked" }),
          });
          panelView();
        } else if (btn.dataset.act === "imp") {
          const { token: impToken } = await api(`/admin/tenants/${tid}/impersonate`, { method: "POST" });
          window.open(`/#token=${impToken}`, "_blank");
        } else if (btn.dataset.act === "purge") {
          if (prompt('Type PURGE to permanently delete this tenant and ALL its data:') === "PURGE") {
            await api(`/admin/tenants/${tid}/purge`, { method: "POST", body: JSON.stringify({ confirm: "PURGE" }) });
            panelView();
          }
        }
      };
    });
  }

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
