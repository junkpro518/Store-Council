/* Store Council — owner dashboard (no build step, no dependencies) */
"use strict";

// ---------------------------------------------------------------- state

const state = {
  token: localStorage.getItem("sc_token") || "",
  lang: localStorage.getItem("sc_lang") || "ar",
  agents: [],
  status: null,
};

// ---------------------------------------------------------------- i18n

const STRINGS = {
  appName: { ar: "مجلس المتجر", en: "Store Council" },
  tagline: { ar: "فريق إدارة ذكي لمتجرك في سلة", en: "An AI management team for your Salla store" },
  dashboard: { ar: "لوحة المتابعة", en: "Dashboard" },
  reports: { ar: "التقارير اليومية", en: "Daily Reports" },
  chat: { ar: "تحدث مع المدراء", en: "Chat with Managers" },
  managers: { ar: "إدارة المدراء", en: "Managers" },
  settings: { ar: "الإعدادات", en: "Settings" },
  logout: { ar: "تسجيل الخروج", en: "Log out" },
  login: { ar: "تسجيل الدخول", en: "Log in" },
  password: { ar: "كلمة المرور", en: "Password" },
  setupTitle: { ar: "مرحباً! لنُؤمّن منصتك أولاً", en: "Welcome! Let's secure your platform" },
  setupHint: { ar: "اختر كلمة مرور للمالك (٨ أحرف على الأقل). ستحتاجها للدخول إلى اللوحة.", en: "Choose an owner password (min 8 characters). You'll use it to access the dashboard." },
  create: { ar: "إنشاء", en: "Create" },
  wrongPassword: { ar: "كلمة المرور غير صحيحة", en: "Wrong password" },
  runNow: { ar: "تشغيل التحليل الآن", en: "Run analysis now" },
  running: { ar: "التحليل قيد التشغيل…", en: "Analysis running…" },
  noReports: { ar: "لا توجد تقارير بعد. شغّل أول تحليل من الزر أعلاه، أو انتظر الموعد اليومي.", en: "No reports yet. Run your first analysis with the button above, or wait for the daily schedule." },
  latestReport: { ar: "تقرير اليوم", en: "Today's report" },
  actions: { ar: "الإجراءات المقترحة", en: "Recommended actions" },
  actionsDone: { ar: "منجزة", en: "done" },
  markDone: { ar: "تم التنفيذ", en: "Mark done" },
  dismiss: { ar: "تجاهل", en: "Dismiss" },
  restore: { ar: "إرجاع", en: "Restore" },
  what: { ar: "ماذا", en: "What" },
  why: { ar: "لماذا", en: "Why" },
  how: { ar: "طريقة التنفيذ", en: "How to implement" },
  impact: { ar: "الأثر المتوقع", en: "Expected impact" },
  askManager: { ar: "اسأل المدير", en: "Ask the manager" },
  fullSummary: { ar: "التقرير الكامل", en: "Full report" },
  deptFindings: { ar: "نتائج الأقسام", en: "Department findings" },
  send: { ar: "إرسال", en: "Send" },
  thinking: { ar: "يراجع بيانات متجرك ويفكر…", en: "Reviewing your store data and thinking…" },
  chatPlaceholder: { ar: "اكتب سؤالك للمدير…", en: "Ask the manager anything…" },
  clearChat: { ar: "مسح المحادثة", en: "Clear chat" },
  storeNotConnected: { ar: "متجرك غير مربوط بعد — اربطه من صفحة الإعدادات.", en: "Your store is not connected yet — connect it from Settings." },
  enabled: { ar: "مفعّل", en: "Enabled" },
  disabled: { ar: "معطّل", en: "Disabled" },
  orchestratorNote: { ar: "المدير العام لا يمكن تعطيله — هو من يكتب التقرير اليومي.", en: "The General Manager can't be disabled — it writes the daily report." },
  displayName: { ar: "الاسم الظاهر", en: "Display name" },
  customInstructions: { ar: "تعليمات دائمة من المالك", en: "Standing instructions from you" },
  customInstructionsHint: { ar: "تُضاف لشخصية المدير في كل محادثة وتحليل. مثال: «ركّز على منتجات العطور، وتجاهل قسم الإكسسوارات».", en: "Added to this manager's persona in every chat and analysis. e.g. \"Focus on perfume products; ignore the accessories category.\"" },
  focusAreas: { ar: "مجالات التركيز (سطر لكل مجال — اتركها فارغة للافتراضي)", en: "Focus areas (one per line — leave empty for defaults)" },
  save: { ar: "حفظ", en: "Save" },
  saved: { ar: "تم الحفظ ✓", en: "Saved ✓" },
  general: { ar: "عام", en: "General" },
  aiSettings: { ar: "الذكاء الاصطناعي", en: "AI" },
  anthropicKey: { ar: "مفتاح Anthropic API", en: "Anthropic API key" },
  anthropicKeyHint: { ar: "من console.anthropic.com — يلزم لتشغيل المدراء.", en: "From console.anthropic.com — required to run the managers." },
  model: { ar: "النموذج", en: "Model" },
  language: { ar: "لغة إجابات المدراء", en: "Managers' reply language" },
  langAuto: { ar: "تلقائي (حسب لغة سؤالك)", en: "Auto (mirror your language)" },
  langAr: { ar: "العربية دائماً", en: "Always Arabic" },
  langEn: { ar: "الإنجليزية دائماً", en: "Always English" },
  storeContext: { ar: "عرّف المدراء بمتجرك", en: "Tell the managers about your store" },
  storeContextHint: { ar: "تخصص المتجر، أهدافك، قيودك… يقرأه كل مدير قبل أي تحليل.", en: "Your niche, goals, constraints… every manager reads this before any analysis." },
  schedule: { ar: "التحليل اليومي", en: "Daily analysis" },
  dailyEnabled: { ar: "تشغيل التحليل اليومي تلقائياً", en: "Run the daily analysis automatically" },
  cron: { ar: "موعد التشغيل (صيغة cron)", en: "Schedule (cron expression)" },
  cronHint: { ar: "مثال: 0 5 * * * يعني ٥ فجراً كل يوم.", en: "e.g. 0 5 * * * means 05:00 every day." },
  timezone: { ar: "المنطقة الزمنية", en: "Timezone" },
  topActions: { ar: "عدد الإجراءات في التقرير اليومي", en: "Actions per daily report" },
  concurrency: { ar: "عدد المدراء العاملين بالتوازي", en: "Managers running in parallel" },
  sallaSection: { ar: "ربط متجر سلة", en: "Salla store connection" },
  sallaHint: { ar: "أنشئ تطبيقاً في بوابة شركاء سلة (salla.partners) بصلاحيات قراءة فقط، وضع رابط الرجوع أدناه في إعدادات التطبيق.", en: "Create an app in the Salla Partners portal (salla.partners) with read-only scopes, and set the callback URL below in the app settings." },
  connected: { ar: "المتجر مربوط ✓", en: "Store connected ✓" },
  notConnected: { ar: "غير مربوط", en: "Not connected" },
  connectStore: { ar: "ربط المتجر", en: "Connect store" },
  disconnectStore: { ar: "فصل المتجر", en: "Disconnect store" },
  security: { ar: "الأمان", en: "Security" },
  currentPassword: { ar: "كلمة المرور الحالية", en: "Current password" },
  newPassword: { ar: "كلمة المرور الجديدة", en: "New password" },
  changePassword: { ar: "تغيير كلمة المرور", en: "Change password" },
  passwordChanged: { ar: "تم تغيير كلمة المرور — سجّل الدخول من جديد.", en: "Password changed — please log in again." },
  noActions: { ar: "لا توجد إجراءات مستخرجة في هذا التقرير.", en: "No structured actions in this report." },
  viewReport: { ar: "عرض", en: "View" },
  date: { ar: "التاريخ", en: "Date" },
  needsKey: { ar: "أضف مفتاح Anthropic API من الإعدادات لتشغيل المدراء.", en: "Add your Anthropic API key in Settings to power the managers." },
  recentEvents: { ar: "آخر أحداث المتجر", en: "Recent store events" },
  noEvents: { ar: "لا توجد أحداث بعد. تصل الأحداث تلقائياً عبر Webhooks بعد ضبطها في بوابة شركاء سلة.", en: "No events yet. Events arrive automatically via webhooks once configured in the Salla Partners portal." },
  webhookSecret: { ar: "سر التوقيع (Webhook Secret)", en: "Webhook secret" },
  webhookSecretHint: { ar: "من إعدادات تطبيقك في بوابة الشركاء — يُستخدم للتحقق من توقيع الأحداث.", en: "From your app settings in the Partners portal — used to verify event signatures." },
  webhookUrl: { ar: "رابط الـ Webhook (ضعه في بوابة الشركاء)", en: "Webhook URL (set it in the Partners portal)" },
  easyModeNote: { ar: "عند نشر التطبيق في متجر تطبيقات سلة، يصل تفويض المتجر تلقائياً عبر حدث app.store.authorize — لا حاجة لزر الربط.", en: "When listed on the Salla App Store, store authorization arrives automatically via the app.store.authorize event — no connect button needed." },
  diagnostics: { ar: "فحص النظام", en: "System check" },
  runChecks: { ar: "تشغيل الفحص", en: "Run checks" },
  checking: { ar: "جارٍ الفحص…", en: "Checking…" },
  connectedVia: { ar: "مربوط عبر", en: "Connected via" },
  viaAppStore: { ar: "متجر تطبيقات سلة", en: "Salla App Store" },
  viaOauth: { ar: "ربط يدوي (OAuth)", en: "Manual OAuth" },
  provider: { ar: "مزوّد الذكاء الاصطناعي", en: "AI provider" },
  providerHint: { ar: "Anthropic مباشرة (مستحسن)، أو OpenRouter للوصول لنماذج متعددة بمفتاح واحد.", en: "Anthropic directly (recommended), or OpenRouter for access to many models with one key." },
  openRouterKey: { ar: "مفتاح OpenRouter API", en: "OpenRouter API key" },
  openRouterKeyHint: { ar: "من openrouter.ai/keys", en: "From openrouter.ai/keys" },
  openRouterModel: { ar: "معرّف النموذج في OpenRouter", en: "OpenRouter model id" },
  openRouterModelHint: { ar: "أي نموذج يدعم استدعاء الأدوات من openrouter.ai/models — مثال: anthropic/claude-sonnet-4.5", en: "Any tool-calling model from openrouter.ai/models — e.g. anthropic/claude-sonnet-4.5" },
  needsAiKey: { ar: "أضف مفتاح مزوّد الذكاء الاصطناعي من الإعدادات لتشغيل المدراء.", en: "Add your AI provider's API key in Settings to power the managers." },
  memoryTitle: { ar: "ذاكرة المدير (الدروس والملاحظات المتراكمة)", en: "Manager's memory (accumulated lessons & feedback)" },
  noMemories: { ar: "لا توجد ذكريات بعد — تتراكم تلقائياً من التحليلات وتفاعلك مع التوصيات.", en: "No memories yet — they accumulate automatically from analyses and your responses to recommendations." },
  forget: { ar: "حذف", en: "Forget" },
  achievements: { ar: "سجل الإنجاز", en: "Achievement ledger" },
  achievementsHint: { ar: "كل توصية نفّذتها — مع الأثر المقاس بعد أسبوعين من بيانات متجرك الفعلية.", en: "Every recommendation you implemented — with its impact measured after two weeks from your store's real data." },
  noAchievements: { ar: "لا إنجازات بعد — علّم التوصيات بـ«تم التنفيذ» وسيقيس المجلس أثرها تلقائياً.", en: "Nothing yet — mark recommendations as done and the council will measure their impact automatically." },
  measuredImpact: { ar: "الأثر المقاس", en: "Measured impact" },
  awaitingMeasure: { ar: "القياس بعد ~١٤ يوماً من التنفيذ", en: "Measured ~14 days after implementation" },
  mcpSection: { ar: "اربط المجلس بـ Claude / ChatGPT (MCP)", en: "Connect the council to Claude / ChatGPT (MCP)" },
  mcpHint: { ar: "أضف هذا الرابط والمفتاح كـ Custom Connector في Claude أو ChatGPT لتتحدث مع مدرائك (بذاكرتهم وتقاريرهم) من داخل أي تطبيق ذكاء اصطناعي.", en: "Add this URL and token as a custom connector in Claude or ChatGPT to talk to YOUR managers (with their memory and reports) from inside any AI app." },
  mcpToken: { ar: "مفتاح الربط (Bearer token)", en: "Integration token (Bearer)" },
  rotateToken: { ar: "توليد مفتاح جديد", en: "Rotate token" },
  rotateWarn: { ar: "توليد مفتاح جديد يفصل أي ربط حالي.", en: "Rotating disconnects existing connectors." },
  writeMode: { ar: "صلاحيات التعديل على المتجر", en: "Store edit permissions" },
  writeModeHint: { ar: "حدد ما إذا كان المدراء يقترحون فقط، أو يعدّلون بعد موافقتك، أو يعدّلون مباشرة. التعديلات محصورة بالمنتجات والكوبونات والعروض والتصنيفات — لا حذف أبداً.", en: "Choose whether managers only advise, edit after your approval, or edit directly. Edits are limited to products, coupons, offers, and categories — never deletions." },
  wmReadOnly: { ar: "قراءة فقط (الافتراضي الآمن)", en: "Read only (safe default)" },
  wmConfirm: { ar: "تعديل بعد موافقتي", en: "Edit after my confirmation" },
  wmAuto: { ar: "تعديل مباشر بدون موافقة ⚠️", en: "Edit without confirmation ⚠️" },
  wmInherit: { ar: "حسب الإعداد العام", en: "Use global setting" },
  agentWriteMode: { ar: "صلاحية التعديل لهذا المدير", en: "This manager's edit permission" },
  pendingChanges: { ar: "تعديلات بانتظار موافقتك", en: "Changes awaiting your approval" },
  changeJournal: { ar: "سجل التعديلات", en: "Change journal" },
  approve: { ar: "موافقة وتنفيذ", en: "Approve & apply" },
  reject: { ar: "رفض", en: "Reject" },
  rejectReason: { ar: "سبب الرفض (يتعلم منه المدير)", en: "Reason (the manager learns from it)" },
  noPending: { ar: "لا توجد تعديلات معلّقة.", en: "No pending changes." },
  managerQuestions: { ar: "أسئلة من مدرائك", en: "Questions from your managers" },
  managerQuestionsHint: { ar: "أجوبتك تُحفظ في ذاكرة المدير وتحسّن توصياته القادمة.", en: "Your answers are saved to the manager's memory and improve future advice." },
  answerBtn: { ar: "إرسال الجواب", en: "Send answer" },
  answerPlaceholder: { ar: "اكتب جوابك…", en: "Write your answer…" },
  dismissQ: { ar: "تجاهل", en: "Dismiss" },
  knowledgeTitle: { ar: "قاعدة المعرفة (مستندات تزوّد بها هذا المدير)", en: "Knowledge base (documents you provide to this manager)" },
  knowledgeHint: { ar: "أسعار الموردين، سياساتك، إرشادات العلامة… معلومات خارج سلة يعتمد عليها المدير.", en: "Supplier prices, your policies, brand guidelines… information outside Salla the manager relies on." },
  addDoc: { ar: "إضافة مستند", en: "Add document" },
  docTitle: { ar: "عنوان المستند", en: "Document title" },
  docContent: { ar: "المحتوى", en: "Content" },
  deleteDoc: { ar: "حذف", en: "Delete" },
  noDocs: { ar: "لا مستندات بعد.", en: "No documents yet." },
  embedSection: { ar: "تضمين اللوحة داخل لوحة سلة", en: "Embed inside the Salla dashboard" },
  embedHint: { ar: "ضع هذا الرابط كعنوان التطبيق (App URL) في بوابة شركاء سلة، فيفتح مجلس المتجر داخل لوحة سلة مع تسجيل دخول تلقائي. لا تشارك الرابط مع أحد — وداخل الإطار يعمل كل شيء كالمعتاد.", en: "Set this URL as the App URL in the Salla Partners portal — Store Council then opens inside the Salla dashboard with automatic login. Keep the link private; everything works normally inside the frame." },
  embedRotate: { ar: "توليد رابط جديد", en: "Rotate link" },
  embedRotateWarn: { ar: "التوليد يبطل الرابط القديم المضمّن في سلة.", en: "Rotating invalidates the old link configured in Salla." },
  mentionHint: { ar: "اكتب @ لتوجيه سؤالك لمدير محدد", en: "Type @ to direct your question to a specific manager" },
};

function t(key) {
  const entry = STRINGS[key];
  return entry ? entry[state.lang] || entry.ar : key;
}

// ---------------------------------------------------------------- helpers

const $app = document.getElementById("app");

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/* Minimal markdown renderer (headings, bold, italic, code, lists, tables). */
function md(text) {
  const lines = esc(text).split("\n");
  let html = "", inUl = false, inOl = false, inPre = false, inTable = false;
  const closeLists = () => {
    if (inUl) { html += "</ul>"; inUl = false; }
    if (inOl) { html += "</ol>"; inOl = false; }
    if (inTable) { html += "</table>"; inTable = false; }
  };
  const inline = (s) =>
    s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
     .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
     .replace(/`([^`]+)`/g, "<code>$1</code>");
  for (const raw of lines) {
    if (raw.trim().startsWith("```")) {
      closeLists();
      html += inPre ? "</pre>" : "<pre>";
      inPre = !inPre;
      continue;
    }
    if (inPre) { html += raw + "\n"; continue; }
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeLists(); html += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inUl) { closeLists(); html += "<ul>"; inUl = true; }
      html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`; continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      if (!inOl) { closeLists(); html += "<ol>"; inOl = true; }
      html += `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>`; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; // separator row
      if (!inTable) { closeLists(); html += "<table>"; inTable = true; }
      const cells = line.trim().slice(1, -1).split("|").map((c) => inline(c.trim()));
      html += "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>";
      continue;
    }
    closeLists();
    if (line.trim() === "") html += "";
    else html += `<p>${inline(line)}</p>`;
  }
  closeLists();
  if (inPre) html += "</pre>";
  return `<div class="md">${html}</div>`;
}

/**
 * Parse a leading @mention against the agent roster. Matches (longest first,
 * case-insensitive): display name, Arabic name, default name, or id —
 * followed by whitespace or end. Returns {agent, rest} or null.
 */
function parseMention(text, agents) {
  const trimmed = String(text).trimStart();
  if (!trimmed.startsWith("@")) return null;
  const after = trimmed.slice(1);
  let best = null;
  for (const a of agents) {
    if (!a.enabled) continue;
    for (const label of [a.name, a.nameAr, a.defaultName, a.id]) {
      if (!label) continue;
      if (after.toLowerCase().startsWith(label.toLowerCase())) {
        const next = after.slice(label.length);
        if (next === "" || /^[\s:،,]/.test(next)) {
          if (!best || label.length > best.label.length) {
            best = { agent: a, label, rest: next.replace(/^[\s:،,]+/, "") };
          }
        }
      }
    }
  }
  return best ? { agent: best.agent, rest: best.rest } : null;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    state.token = "";
    localStorage.removeItem("sc_token");
    route();
    throw new Error("Unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setLangAttrs() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === "ar" ? "rtl" : "ltr";
}

function toggleLang() {
  state.lang = state.lang === "ar" ? "en" : "ar";
  localStorage.setItem("sc_lang", state.lang);
  setLangAttrs();
  route();
}

function notice(el, kind, text) {
  el.innerHTML = `<div class="notice ${kind}">${esc(text)}</div>`;
  if (kind === "ok") setTimeout(() => { el.innerHTML = ""; }, 2500);
}

// ---------------------------------------------------------------- shell

function shell(activeView, contentHtml) {
  const nav = [
    ["dashboard", t("dashboard")],
    ["reports", t("reports")],
    ["chat", t("chat")],
    ["managers", t("managers")],
    ["settings", t("settings")],
  ];
  $app.innerHTML = `
  <div class="layout">
    <nav class="sidebar">
      <div class="brand">${t("appName")}<small>${t("tagline")}</small></div>
      ${nav.map(([id, label]) =>
        `<a href="#/${id}" class="${id === activeView ? "active" : ""}">${label}</a>`).join("")}
      <div class="spacer"></div>
      <div class="foot">
        <button class="ghost small" id="langBtn">${state.lang === "ar" ? "English" : "العربية"}</button>
        <button class="ghost small" id="logoutBtn">${t("logout")}</button>
      </div>
    </nav>
    <main class="main" id="main">${contentHtml}</main>
  </div>`;
  document.getElementById("langBtn").onclick = toggleLang;
  document.getElementById("logoutBtn").onclick = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    state.token = "";
    localStorage.removeItem("sc_token");
    route();
  };
  return document.getElementById("main");
}

// ---------------------------------------------------------------- auth views

function authView(isSetup) {
  setLangAttrs();
  $app.innerHTML = `
  <div class="auth-wrap">
    <div class="card auth-card">
      <h1>${t("appName")}</h1>
      <p class="sub">${isSetup ? t("setupHint") : t("tagline")}</p>
      ${isSetup ? `<h2 style="text-align:center">${t("setupTitle")}</h2>` : ""}
      <label>${t("password")}</label>
      <input type="password" id="pw" autofocus />
      <div id="msg"></div>
      <div style="margin-top:16px; display:flex; gap:10px;">
        <button id="go" style="flex:1">${isSetup ? t("create") : t("login")}</button>
        <button class="ghost fit" id="langBtn">${state.lang === "ar" ? "EN" : "ع"}</button>
      </div>
    </div>
  </div>`;
  document.getElementById("langBtn").onclick = toggleLang;
  const submit = async () => {
    const password = document.getElementById("pw").value;
    try {
      const { token } = await api(isSetup ? "/auth/setup" : "/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      state.token = token;
      localStorage.setItem("sc_token", token);
      location.hash = "#/dashboard";
      route();
    } catch (err) {
      notice(document.getElementById("msg"), "err",
        err.message === "Wrong password" ? t("wrongPassword") : err.message);
    }
  };
  document.getElementById("go").onclick = submit;
  document.getElementById("pw").onkeydown = (e) => { if (e.key === "Enter") submit(); };
}

// ---------------------------------------------------------------- dashboard

function actionItemHtml(a, i) {
  const mgr = state.agents.find((x) => x.id === a.manager);
  return `
  <div class="action-item ${a.status === "done" ? "done" : ""}" data-i="${i}">
    <div class="head">
      <span class="badge">#${a.priority}</span>
      <h3>${esc(a.title)}</h3>
      ${mgr ? `<a class="badge" href="#/chat/${mgr.id}">${esc(mgr.name)}</a>` : ""}
      ${a.status === "dismissed" ? `<span class="badge off">${t("dismiss")}</span>` : ""}
    </div>
    <div class="body">
      <dl>
        <dt>${t("what")}</dt><dd>${esc(a.what)}</dd>
        <dt>${t("why")}</dt><dd>${esc(a.why)}</dd>
        <dt>${t("how")}</dt><dd>${md(a.how)}</dd>
        <dt>${t("impact")}</dt><dd>${esc(a.impact)}</dd>
        ${a.measuredImpact
          ? `<dt>📊 ${t("measuredImpact")} (${esc((a.measuredAt || "").slice(0, 10))})</dt><dd>${md(a.measuredImpact)}</dd>`
          : a.status === "done"
            ? `<dt>📊 ${t("measuredImpact")}</dt><dd class="sub">${t("awaitingMeasure")}</dd>`
            : ""}
      </dl>
    </div>
    <div class="controls">
      ${a.status !== "done" ? `<button class="small" data-act="done">${t("markDone")}</button>` : ""}
      ${a.status === "new" ? `<button class="small ghost danger" data-act="dismissed">${t("dismiss")}</button>` : ""}
      ${a.status !== "new" ? `<button class="small ghost" data-act="new">${t("restore")}</button>` : ""}
    </div>
  </div>`;
}

function wireActionButtons(container, report, rerender) {
  container.querySelectorAll(".action-item .controls button").forEach((btn) => {
    btn.onclick = async () => {
      const i = Number(btn.closest(".action-item").dataset.i);
      const updated = await api(`/reports/${report.date}/actions/${i}`, {
        method: "POST",
        body: JSON.stringify({ status: btn.dataset.act }),
      });
      rerender(updated);
    };
  });
}

function reportHtml(report) {
  const done = report.actions.filter((a) => a.status === "done").length;
  return `
  <div class="stat-row">
    <div class="stat"><div class="v">${report.date}</div><div class="k">${t("date")}</div></div>
    <div class="stat"><div class="v">${report.actions.length}</div><div class="k">${t("actions")}</div></div>
    <div class="stat"><div class="v">${done}</div><div class="k">${t("actionsDone")}</div></div>
  </div>
  <div class="card">
    <h2 style="margin-top:0">${t("actions")}</h2>
    <div id="actionList">
      ${report.actions.length
        ? report.actions.map(actionItemHtml).join("")
        : `<p class="sub">${t("noActions")}</p>`}
    </div>
  </div>
  <div class="card">
    <details><summary style="cursor:pointer;font-weight:700">${t("fullSummary")}</summary>${md(report.summary)}</details>
  </div>
  <div class="card">
    <h2 style="margin-top:0">${t("deptFindings")}</h2>
    ${Object.entries(report.departments).map(([id, text]) => {
      const mgr = state.agents.find((a) => a.id === id);
      return `<details class="dept"><summary>${esc(mgr ? mgr.name : id)}</summary>${md(text)}</details>`;
    }).join("")}
  </div>`;
}

async function dashboardView() {
  const main = shell("dashboard", `<h1>${t("dashboard")}</h1><p class="sub" id="storeLine">${t("tagline")}</p><div id="body">…</div>`);
  const body = main.querySelector("#body");

  const status = await api("/auth/status");
  const warnings = [];
  if (!status.aiConfigured) warnings.push(t("needsAiKey"));
  if (!status.storeConnected) warnings.push(t("storeNotConnected"));

  let report = null;
  try { report = await api("/reports/latest"); } catch {}
  const { running } = await api("/reports/status");
  let events = [];
  try { events = await api("/store/events"); } catch {}

  if (status.storeConnected) {
    api("/store/summary").then((s) => {
      if (s.name) {
        document.getElementById("storeLine").textContent =
          `${s.name}${s.domain ? " — " + s.domain : ""}`;
      }
    }).catch(() => {});
  }

  const render = (r) => {
    report = r;
    body.innerHTML = `
      ${warnings.map((w) => `<div class="notice err">${esc(w)} <a href="#/settings">${t("settings")} ←</a></div>`).join("")}
      <div class="row" style="margin-bottom:16px">
        <button id="runBtn" class="fit" ${running || warnings.length ? "disabled" : ""}>
          ${running ? t("running") : t("runNow")}
        </button>
      </div>
      ${report ? `<h2>${t("latestReport")}</h2>${reportHtml(report)}` : `<div class="card"><p class="sub">${t("noReports")}</p></div>`}
      <div class="card" id="questionsCard" hidden>
        <h2 style="margin-top:0">💬 ${t("managerQuestions")}</h2>
        <p class="sub">${t("managerQuestionsHint")}</p>
        <div id="questionList"></div>
      </div>
      <div class="card" id="changesCard" hidden>
        <h2 style="margin-top:0">✋ ${t("pendingChanges")}</h2>
        <div id="changeList"></div>
      </div>
      <div class="card">
        <h2 style="margin-top:0">🏆 ${t("achievements")}</h2>
        <p class="sub">${t("achievementsHint")}</p>
        <div id="achList">…</div>
      </div>
      <div class="card">
        <h2 style="margin-top:0">${t("recentEvents")}</h2>
        ${events.length
          ? events.slice(0, 12).map((e) => `
            <div class="action-item">
              <div class="head">
                <span class="badge">${esc(e.event)}</span>
                <h3 style="font-weight:400;font-size:0.92rem">${esc(e.summary)}</h3>
                <span class="sub" style="font-size:0.78rem">${esc(e.receivedAt.slice(0, 16).replace("T", " "))}</span>
              </div>
            </div>`).join("")
          : `<p class="sub">${t("noEvents")}</p>`}
      </div>`;
    if (report) wireActionButtons(body, report, render);
    const questionsCard = body.querySelector("#questionsCard");
    const loadQuestions = async () => {
      const pending = await api("/questions?status=pending").catch(() => []);
      if (!questionsCard) return;
      questionsCard.hidden = pending.length === 0;
      if (pending.length === 0) return;
      questionsCard.querySelector("#questionList").innerHTML = pending.map((q) => {
        const mgr = state.agents.find((x) => x.id === q.agentId);
        return `
        <div class="action-item" data-qid="${esc(q.id)}">
          <div class="head">
            ${mgr ? `<span class="badge">${esc(mgr.name)}</span>` : ""}
            <h3 style="font-weight:600;font-size:0.95rem">${esc(q.question)}</h3>
          </div>
          ${q.context ? `<div class="body sub">${esc(q.context)}</div>` : ""}
          <div class="row" style="margin-top:8px">
            <input type="text" class="qAnswer" placeholder="${t("answerPlaceholder")}" />
            <button class="small fit" data-act="answer">${t("answerBtn")}</button>
            <button class="small ghost danger fit" data-act="dismiss">${t("dismissQ")}</button>
          </div>
        </div>`;
      }).join("");
      questionsCard.querySelectorAll("[data-act]").forEach((btn) => {
        btn.onclick = async () => {
          const item = btn.closest("[data-qid]");
          const qid = item.dataset.qid;
          if (btn.dataset.act === "answer") {
            const answer = item.querySelector(".qAnswer").value.trim();
            if (!answer) return;
            await api(`/questions/${qid}/answer`, { method: "POST", body: JSON.stringify({ answer }) });
          } else {
            await api(`/questions/${qid}/dismiss`, { method: "POST" });
          }
          loadQuestions();
        };
      });
    };
    loadQuestions();

    const changesCard = body.querySelector("#changesCard");
    const loadChanges = async () => {
      const pending = await api("/changes?status=pending").catch(() => []);
      if (!changesCard) return;
      changesCard.hidden = pending.length === 0;
      if (pending.length === 0) return;
      changesCard.querySelector("#changeList").innerHTML = pending.map((c) => {
        const mgr = state.agents.find((x) => x.id === c.agentId);
        return `
        <div class="action-item" data-cid="${esc(c.id)}">
          <div class="head">
            <span class="badge">${esc(c.method)} ${esc(c.endpoint)}</span>
            <h3 style="font-weight:400;font-size:0.95rem">${esc(c.description)}</h3>
            ${mgr ? `<span class="badge">${esc(mgr.name)}</span>` : ""}
          </div>
          <details class="dept"><summary>JSON</summary><pre style="font-size:0.78rem;overflow-x:auto">${esc(JSON.stringify(c.payload, null, 2))}</pre></details>
          <div class="controls">
            <button class="small" data-act="approve">${t("approve")}</button>
            <button class="small ghost danger" data-act="reject">${t("reject")}</button>
          </div>
        </div>`;
      }).join("");
      changesCard.querySelectorAll("[data-act]").forEach((btn) => {
        btn.onclick = async () => {
          const cid = btn.closest("[data-cid]").dataset.cid;
          btn.disabled = true;
          if (btn.dataset.act === "approve") {
            await api(`/changes/${cid}/approve`, { method: "POST" });
          } else {
            const reason = prompt(t("rejectReason")) ?? "";
            await api(`/changes/${cid}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
          }
          loadChanges();
        };
      });
    };
    loadChanges();

    const achList = body.querySelector("#achList");
    if (achList) {
      api("/achievements").then((items) => {
        achList.innerHTML = items.length
          ? items.slice(0, 10).map((a) => {
              const mgr = state.agents.find((x) => x.id === a.manager);
              return `
              <div class="action-item">
                <div class="head">
                  <h3>${esc(a.title)}</h3>
                  ${mgr ? `<span class="badge">${esc(mgr.name)}</span>` : ""}
                  <span class="sub" style="font-size:0.78rem">${esc((a.statusChangedAt || a.date).slice(0, 10))}</span>
                </div>
                ${a.measuredImpact
                  ? `<div class="body">📊 ${md(a.measuredImpact)}</div>`
                  : `<div class="body sub">${t("awaitingMeasure")}</div>`}
              </div>`;
            }).join("")
          : `<p class="sub">${t("noAchievements")}</p>`;
      }).catch(() => { achList.innerHTML = ""; });
    }
    const runBtn = body.querySelector("#runBtn");
    if (runBtn) runBtn.onclick = async () => {
      runBtn.disabled = true;
      runBtn.textContent = t("running");
      await api("/reports/run", { method: "POST" });
      const poll = setInterval(async () => {
        const s = await api("/reports/status");
        if (!s.running) {
          clearInterval(poll);
          dashboardView();
        }
      }, 5000);
    };
  };
  render(report);
}

// ---------------------------------------------------------------- reports

async function reportsView(dateParam) {
  const main = shell("reports", `<h1>${t("reports")}</h1><div id="body">…</div>`);
  const body = main.querySelector("#body");

  if (dateParam) {
    const report = await api(`/reports/${dateParam}`);
    const render = (r) => {
      body.innerHTML = `<p class="sub"><a href="#/reports">← ${t("reports")}</a></p>` + reportHtml(r);
      wireActionButtons(body, r, render);
    };
    render(report);
    return;
  }

  const reports = await api("/reports");
  body.innerHTML = reports.length
    ? `<div class="card">${reports.map((r) => `
        <div class="action-item">
          <div class="head">
            <h3>${r.date}</h3>
            <span class="badge">${r.doneCount}/${r.actionCount} ${t("actionsDone")}</span>
            <a class="btn small" href="#/reports/${r.date}">${t("viewReport")}</a>
          </div>
        </div>`).join("")}</div>`
    : `<div class="card"><p class="sub">${t("noReports")}</p></div>`;
}

// ---------------------------------------------------------------- chat

async function chatView(agentId) {
  const enabled = state.agents.filter((a) => a.enabled);
  const current = enabled.find((a) => a.id === agentId) || enabled[0];
  const main = shell("chat", `<h1>${t("chat")}</h1><div id="body">…</div>`);
  const body = main.querySelector("#body");
  if (!current) { body.innerHTML = `<div class="card"><p class="sub">${t("storeNotConnected")}</p></div>`; return; }

  body.innerHTML = `
  <div class="chat-layout">
    <div class="chat-agents">
      ${state.agents.map((a) => `
        <button class="agent-pick ${a.id === current.id ? "active" : ""}" data-id="${a.id}" ${a.enabled ? "" : "disabled"}>
          ${esc(a.name)}<small>${esc(a.title)}</small>
        </button>`).join("")}
    </div>
    <div class="chat-panel">
      <div class="chat-head">
        <h2>${esc(current.name)} <span class="sub" style="font-weight:400">— ${esc(current.title)}</span></h2>
        <button class="ghost small" id="clearBtn">${t("clearChat")}</button>
      </div>
      <div class="chat-msgs" id="msgs"></div>
      <div class="typing" id="typing" hidden>${t("thinking")}</div>
      <div class="chat-input" style="position:relative">
        <div id="mentionPopup" class="card" style="position:absolute;bottom:100%;inset-inline-start:12px;margin:0 0 4px;padding:6px;max-height:200px;overflow-y:auto;z-index:5" hidden></div>
        <textarea id="input" placeholder="${t("chatPlaceholder")} — ${t("mentionHint")}"></textarea>
        <button id="sendBtn" class="fit">${t("send")}</button>
      </div>
    </div>
  </div>`;

  body.querySelectorAll(".agent-pick").forEach((b) => {
    b.onclick = () => { location.hash = `#/chat/${b.dataset.id}`; };
  });

  const msgs = body.querySelector("#msgs");
  const input = body.querySelector("#input");
  const typing = body.querySelector("#typing");

  const renderMsgs = (history) => {
    msgs.innerHTML = history.map((m) =>
      `<div class="msg ${m.role}">${m.role === "assistant" ? md(m.content) : esc(m.content)}</div>`).join("");
    msgs.scrollTop = msgs.scrollHeight;
  };

  const { history } = await api(`/agents/${current.id}/chat`);
  renderMsgs(history);

  body.querySelector("#clearBtn").onclick = async () => {
    await api(`/agents/${current.id}/chat`, { method: "DELETE" });
    renderMsgs([]);
  };

  const deliver = async (message) => {
    history.push({ role: "user", content: message });
    renderMsgs(history);
    typing.hidden = false;
    try {
      const { reply } = await api(`/agents/${current.id}/chat`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      history.push({ role: "assistant", content: reply });
    } catch (err) {
      history.push({ role: "assistant", content: `⚠️ ${err.message}` });
    }
    typing.hidden = true;
    renderMsgs(history);
  };

  const send = async () => {
    const raw = input.value.trim();
    if (!raw) return;
    input.value = "";
    const mention = parseMention(raw, state.agents);
    if (mention && mention.agent.id !== current.id) {
      // Route to the mentioned manager: navigate there, then deliver.
      if (mention.rest) {
        sessionStorage.setItem(
          "sc_pending_msg",
          JSON.stringify({ agentId: mention.agent.id, message: mention.rest })
        );
      }
      location.hash = `#/chat/${mention.agent.id}`;
      return;
    }
    await deliver(mention ? mention.rest || raw : raw);
  };
  body.querySelector("#sendBtn").onclick = send;

  // @mention autocomplete popup
  const popup = body.querySelector("#mentionPopup");
  input.addEventListener("input", () => {
    const m = input.value.match(/(^|\s)@([^\s@]*)$/);
    if (!m) { popup.hidden = true; return; }
    const q = m[2].toLowerCase();
    const matches = state.agents.filter((a) =>
      a.enabled &&
      (a.id.startsWith(q) || a.name.toLowerCase().includes(q) || (a.nameAr || "").includes(m[2]))
    ).slice(0, 8);
    if (matches.length === 0) { popup.hidden = true; return; }
    popup.innerHTML = matches.map((a) =>
      `<button class="agent-pick" data-mid="${a.id}">@${esc(a.id)}<small>${esc(a.name)} — ${esc(a.nameAr)}</small></button>`).join("");
    popup.hidden = false;
    popup.querySelectorAll("[data-mid]").forEach((b) => {
      b.onclick = () => {
        input.value = input.value.replace(/(^|\s)@[^\s@]*$/, `$1@${b.dataset.mid} `);
        popup.hidden = true;
        input.focus();
      };
    });
  });
  input.onkeydown = (e) => {
    if (e.key === "Escape") popup.hidden = true;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); popup.hidden = true; send(); }
  };

  // Deliver a message routed here by an @mention from another manager's chat.
  const pendingRaw = sessionStorage.getItem("sc_pending_msg");
  if (pendingRaw) {
    try {
      const pending = JSON.parse(pendingRaw);
      if (pending.agentId === current.id) {
        sessionStorage.removeItem("sc_pending_msg");
        deliver(pending.message);
      }
    } catch {
      sessionStorage.removeItem("sc_pending_msg");
    }
  }
}

// ---------------------------------------------------------------- managers

async function managersView() {
  const main = shell("managers", `<h1>${t("managers")}</h1><p class="sub">${t("orchestratorNote")}</p><div id="body" class="grid"></div>`);
  const body = main.querySelector("#body");

  body.innerHTML = state.agents.map((a) => `
    <div class="card agent-card" data-id="${a.id}">
      <div class="top">
        <h3>${esc(a.name)} <span class="sub" style="font-weight:400">${esc(a.nameAr)}</span></h3>
        <span class="badge ${a.enabled ? "" : "off"}">${a.enabled ? t("enabled") : t("disabled")}</span>
        ${a.isOrchestrator ? "" : `
          <label class="switch">
            <input type="checkbox" class="enableToggle" ${a.enabled ? "checked" : ""} />
            <span></span>
          </label>`}
      </div>
      <p class="meta">${esc(a.title)} — ${esc(a.expertise)}</p>
      <label>${t("displayName")}</label>
      <input type="text" class="dn" value="${esc(a.name === a.defaultName ? "" : a.name)}" placeholder="${esc(a.defaultName)}" />
      <label>${t("customInstructions")} <span class="hint">— ${t("customInstructionsHint")}</span></label>
      <textarea class="ci">${esc(a.customInstructions)}</textarea>
      ${a.isOrchestrator ? "" : `
      <label>${t("agentWriteMode")}</label>
      <select class="wm">
        <option value="inherit" ${a.writeModeOverride === "inherit" ? "selected" : ""}>${t("wmInherit")}</option>
        <option value="read_only" ${a.writeModeOverride === "read_only" ? "selected" : ""}>${t("wmReadOnly")}</option>
        <option value="confirm" ${a.writeModeOverride === "confirm" ? "selected" : ""}>${t("wmConfirm")}</option>
        <option value="auto" ${a.writeModeOverride === "auto" ? "selected" : ""}>${t("wmAuto")}</option>
      </select>`}
      <label>${t("focusAreas")}</label>
      <textarea class="fo" placeholder="${esc(a.defaultFocus.join("\n"))}">${esc(
        JSON.stringify(a.focus) === JSON.stringify(a.defaultFocus) ? "" : a.focus.join("\n")
      )}</textarea>
      <div class="row" style="margin-top:12px">
        <button class="small fit saveBtn">${t("save")}</button>
        <div class="fit msg"></div>
      </div>
      <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600;font-size:0.86rem">${t("memoryTitle")}</summary>
        <div class="memList sub" style="font-size:0.84rem">…</div>
      </details>
      <details class="kbDetails" style="margin-top:6px"><summary style="cursor:pointer;font-weight:600;font-size:0.86rem">${t("knowledgeTitle")}</summary>
        <p class="sub" style="font-size:0.8rem">${t("knowledgeHint")}</p>
        <div class="kbList" style="font-size:0.84rem">…</div>
        <input type="text" class="kbTitle" placeholder="${t("docTitle")}" style="margin-top:8px" />
        <textarea class="kbContent" placeholder="${t("docContent")}" style="min-height:60px"></textarea>
        <button class="small kbAdd" style="margin-top:6px">${t("addDoc")}</button>
      </details>
    </div>`).join("");

  body.querySelectorAll(".agent-card").forEach((card) => {
    const id = card.dataset.id;
    const memList = card.querySelector(".memList");
    const loadMemory = async () => {
      const items = await api(`/agents/${id}/memory`);
      memList.innerHTML = items.length
        ? items.map((m) => `
            <div style="display:flex;gap:8px;align-items:baseline;border-top:1px solid var(--line);padding:5px 0">
              <span class="badge">${esc(m.type)}</span>
              <span style="flex:1">${esc(m.content)}</span>
              <button class="small ghost danger" data-mid="${esc(m.id)}">${t("forget")}</button>
            </div>`).join("")
        : `<p>${t("noMemories")}</p>`;
      memList.querySelectorAll("button[data-mid]").forEach((b) => {
        b.onclick = async () => {
          await api(`/agents/${id}/memory/${b.dataset.mid}`, { method: "DELETE" });
          loadMemory();
        };
      });
    };
    card.querySelector("details").addEventListener("toggle", (e) => {
      if (e.target.open) loadMemory();
    });

    const kbList = card.querySelector(".kbList");
    const loadKnowledge = async () => {
      const docs = await api(`/agents/${id}/knowledge`);
      kbList.innerHTML = docs.length
        ? docs.map((d) => `
            <div style="display:flex;gap:8px;align-items:baseline;border-top:1px solid var(--line);padding:5px 0">
              <span style="flex:1"><strong>${esc(d.title)}</strong> <span class="sub">(${esc(d.updatedAt.slice(0, 10))}, ${d.content.length} chars)</span></span>
              <button class="small ghost danger" data-did="${esc(d.id)}">${t("deleteDoc")}</button>
            </div>`).join("")
        : `<p class="sub">${t("noDocs")}</p>`;
      kbList.querySelectorAll("button[data-did]").forEach((b) => {
        b.onclick = async () => {
          await api(`/agents/${id}/knowledge/${b.dataset.did}`, { method: "DELETE" });
          loadKnowledge();
        };
      });
    };
    card.querySelector(".kbDetails").addEventListener("toggle", (e) => {
      if (e.target.open) loadKnowledge();
    });
    card.querySelector(".kbAdd").onclick = async () => {
      const title = card.querySelector(".kbTitle").value.trim();
      const content = card.querySelector(".kbContent").value.trim();
      if (!title || !content) return;
      await api(`/agents/${id}/knowledge`, {
        method: "POST",
        body: JSON.stringify({ title, content }),
      });
      card.querySelector(".kbTitle").value = "";
      card.querySelector(".kbContent").value = "";
      loadKnowledge();
    };
    const saveConfig = async (extra = {}) => {
      const focusText = card.querySelector(".fo").value.trim();
      const wmSel = card.querySelector(".wm");
      await api(`/agents/${id}/config`, {
        method: "PUT",
        body: JSON.stringify({
          displayName: card.querySelector(".dn").value.trim(),
          customInstructions: card.querySelector(".ci").value,
          focus: focusText ? focusText.split("\n").map((s) => s.trim()).filter(Boolean) : [],
          ...(wmSel ? { writeMode: wmSel.value } : {}),
          ...extra,
        }),
      });
      state.agents = await api("/agents");
    };
    card.querySelector(".saveBtn").onclick = async () => {
      await saveConfig();
      notice(card.querySelector(".msg"), "ok", t("saved"));
    };
    const toggle = card.querySelector(".enableToggle");
    if (toggle) toggle.onchange = async () => {
      await saveConfig({ enabled: toggle.checked });
      managersView();
    };
  });
}

// ---------------------------------------------------------------- settings

async function settingsView() {
  const main = shell("settings", `<h1>${t("settings")}</h1><div id="body">…</div>`);
  const body = main.querySelector("#body");
  const s = await api("/settings");
  const status = await api("/auth/status");
  let summary = { connected: false, mode: "", name: "" };
  try { summary = await api("/store/summary"); } catch {}
  const webhookUrl = `${location.origin}/webhooks/salla`;

  body.innerHTML = `
  <div class="card">
    <h2 style="margin-top:0">${t("aiSettings")}</h2>
    <label>${t("provider")} <span class="hint">— ${t("providerHint")}</span></label>
    <select id="provider">
      <option value="anthropic" ${s.provider === "anthropic" ? "selected" : ""}>Anthropic</option>
      <option value="openrouter" ${s.provider === "openrouter" ? "selected" : ""}>OpenRouter</option>
    </select>
    <div id="anthropicFields" ${s.provider === "openrouter" ? "hidden" : ""}>
      <label>${t("anthropicKey")} <span class="hint">— ${t("anthropicKeyHint")}</span></label>
      <input type="password" id="apiKey" value="${esc(s.anthropicApiKey)}" placeholder="sk-ant-…" />
      <label>${t("model")}</label>
      <select id="model">
        ${["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"].map((m) =>
          `<option value="${m}" ${s.model === m ? "selected" : ""}>${m}</option>`).join("")}
      </select>
    </div>
    <div id="openrouterFields" ${s.provider === "openrouter" ? "" : "hidden"}>
      <label>${t("openRouterKey")} <span class="hint">— ${t("openRouterKeyHint")}</span></label>
      <input type="password" id="orKey" value="${esc(s.openRouter.apiKey)}" placeholder="sk-or-…" />
      <label>${t("openRouterModel")} <span class="hint">— ${t("openRouterModelHint")}</span></label>
      <input type="text" id="orModel" value="${esc(s.openRouter.model)}" />
    </div>
    <label>${t("language")}</label>
    <select id="language">
      <option value="auto" ${s.language === "auto" ? "selected" : ""}>${t("langAuto")}</option>
      <option value="ar" ${s.language === "ar" ? "selected" : ""}>${t("langAr")}</option>
      <option value="en" ${s.language === "en" ? "selected" : ""}>${t("langEn")}</option>
    </select>
    <label>${t("storeContext")} <span class="hint">— ${t("storeContextHint")}</span></label>
    <textarea id="storeContext">${esc(s.storeContext)}</textarea>
    <label>${t("writeMode")} <span class="hint">— ${t("writeModeHint")}</span></label>
    <select id="writeMode">
      <option value="read_only" ${s.writeMode === "read_only" ? "selected" : ""}>${t("wmReadOnly")}</option>
      <option value="confirm" ${s.writeMode === "confirm" ? "selected" : ""}>${t("wmConfirm")}</option>
      <option value="auto" ${s.writeMode === "auto" ? "selected" : ""}>${t("wmAuto")}</option>
    </select>
  </div>

  <div class="card">
    <h2 style="margin-top:0">${t("schedule")}</h2>
    <div class="row">
      <label class="fit" style="display:flex;align-items:center;gap:10px;margin:0">
        <label class="switch" style="margin:0">
          <input type="checkbox" id="dailyEnabled" ${s.dailyEnabled ? "checked" : ""} />
          <span></span>
        </label>
        ${t("dailyEnabled")}
      </label>
    </div>
    <div class="row">
      <div>
        <label>${t("cron")} <span class="hint">— ${t("cronHint")}</span></label>
        <input type="text" id="cron" value="${esc(s.dailyCron)}" />
      </div>
      <div>
        <label>${t("timezone")}</label>
        <input type="text" id="timezone" value="${esc(s.timezone)}" />
      </div>
    </div>
    <div class="row">
      <div>
        <label>${t("topActions")}</label>
        <input type="number" id="topActions" min="3" max="10" value="${s.topActionsCount}" />
      </div>
      <div>
        <label>${t("concurrency")}</label>
        <input type="number" id="concurrency" min="1" max="8" value="${s.analysisConcurrency}" />
      </div>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">${t("sallaSection")}
      <span class="badge ${status.storeConnected ? "" : "off"}">${status.storeConnected ? t("connected") : t("notConnected")}</span>
      ${summary.connected && summary.mode ? `<span class="badge">${t("connectedVia")}: ${summary.mode === "easy" ? t("viaAppStore") : t("viaOauth")}</span>` : ""}
    </h2>
    <p class="sub">${t("sallaHint")}</p>
    <div class="row">
      <div><label>Client ID</label><input type="text" id="sClientId" value="${esc(s.salla.clientId)}" /></div>
      <div><label>Client Secret</label><input type="password" id="sClientSecret" value="${esc(s.salla.clientSecret)}" /></div>
    </div>
    <label>Callback URL</label>
    <input type="text" id="sRedirect" value="${esc(s.salla.redirectUri)}" />
    <label>${t("webhookSecret")} <span class="hint">— ${t("webhookSecretHint")}</span></label>
    <input type="password" id="sWebhookSecret" value="${esc(s.salla.webhookSecret)}" />
    <label>${t("webhookUrl")}</label>
    <input type="text" readonly value="${esc(webhookUrl)}" onclick="this.select()" />
    <p class="sub" style="margin-top:8px">${t("easyModeNote")}</p>
    <div class="row" style="margin-top:14px">
      <a class="btn fit" id="connectBtn" href="/auth/salla?token=${encodeURIComponent(state.token)}">${t("connectStore")}</a>
      ${status.storeConnected ? `<button class="ghost danger fit" id="disconnectBtn">${t("disconnectStore")}</button>` : ""}
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">${t("embedSection")}</h2>
    <p class="sub">${t("embedHint")}</p>
    <label>App URL</label>
    <input type="text" readonly id="embedUrl" value="…" onclick="this.select()" />
    <div class="row" style="margin-top:12px">
      <button class="ghost danger fit" id="embedRotateBtn">${t("embedRotate")}</button>
      <span class="sub fit">${t("embedRotateWarn")}</span>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">${t("mcpSection")}</h2>
    <p class="sub">${t("mcpHint")}</p>
    <label>MCP URL</label>
    <input type="text" readonly value="${esc(location.origin)}/mcp" onclick="this.select()" />
    <label>${t("mcpToken")}</label>
    <input type="text" readonly id="intToken" value="…" onclick="this.select()" />
    <div class="row" style="margin-top:12px">
      <button class="ghost danger fit" id="rotateBtn">${t("rotateToken")}</button>
      <span class="sub fit">${t("rotateWarn")}</span>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">${t("diagnostics")}</h2>
    <div class="row">
      <button class="ghost fit" id="diagBtn">${t("runChecks")}</button>
      <div id="diagOut"></div>
    </div>
  </div>

  <div class="row" style="margin-bottom:20px">
    <button id="saveBtn" class="fit">${t("save")}</button>
    <div class="fit" id="saveMsg"></div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">${t("security")}</h2>
    <div class="row">
      <div><label>${t("currentPassword")}</label><input type="password" id="pwCur" /></div>
      <div><label>${t("newPassword")}</label><input type="password" id="pwNew" /></div>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="ghost fit" id="pwBtn">${t("changePassword")}</button>
      <div class="fit" id="pwMsg"></div>
    </div>
  </div>`;

  body.querySelector("#provider").onchange = (e) => {
    const isOr = e.target.value === "openrouter";
    body.querySelector("#anthropicFields").hidden = isOr;
    body.querySelector("#openrouterFields").hidden = !isOr;
  };

  body.querySelector("#saveBtn").onclick = async () => {
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({
          provider: body.querySelector("#provider").value,
          anthropicApiKey: body.querySelector("#apiKey").value.trim(),
          model: body.querySelector("#model").value,
          openRouter: {
            apiKey: body.querySelector("#orKey").value.trim(),
            model: body.querySelector("#orModel").value.trim(),
          },
          language: body.querySelector("#language").value,
          storeContext: body.querySelector("#storeContext").value,
          writeMode: body.querySelector("#writeMode").value,
          dailyEnabled: body.querySelector("#dailyEnabled").checked,
          dailyCron: body.querySelector("#cron").value.trim(),
          timezone: body.querySelector("#timezone").value.trim(),
          topActionsCount: Number(body.querySelector("#topActions").value),
          analysisConcurrency: Number(body.querySelector("#concurrency").value),
          salla: {
            clientId: body.querySelector("#sClientId").value.trim(),
            clientSecret: body.querySelector("#sClientSecret").value.trim(),
            redirectUri: body.querySelector("#sRedirect").value.trim(),
            webhookSecret: body.querySelector("#sWebhookSecret").value.trim(),
          },
        }),
      });
      notice(body.querySelector("#saveMsg"), "ok", t("saved"));
    } catch (err) {
      notice(body.querySelector("#saveMsg"), "err", err.message);
    }
  };

  api("/auth/embed-link").then(({ url }) => {
    body.querySelector("#embedUrl").value = url;
  }).catch(() => {});
  body.querySelector("#embedRotateBtn").onclick = async () => {
    const { url } = await api("/auth/embed-link/rotate", { method: "POST" });
    body.querySelector("#embedUrl").value = url;
  };

  api("/integration-token").then(({ token }) => {
    body.querySelector("#intToken").value = token;
  }).catch(() => {});
  body.querySelector("#rotateBtn").onclick = async () => {
    const { token } = await api("/integration-token/rotate", { method: "POST" });
    body.querySelector("#intToken").value = token;
  };

  body.querySelector("#diagBtn").onclick = async () => {
    const out = body.querySelector("#diagOut");
    out.innerHTML = `<span class="sub">${t("checking")}</span>`;
    try {
      const d = await api("/diagnostics");
      const providerLabel = d.provider === "openrouter" ? "OpenRouter" : "Anthropic";
      out.innerHTML = `
        <span class="badge ${d.ai.ok ? "" : "off"}">${providerLabel}: ${esc(d.ai.ok ? "✓ " + d.ai.detail : d.ai.detail)}</span>
        <span class="badge ${d.salla.ok ? "" : "off"}">Salla: ${esc(d.salla.ok ? "✓ " + d.salla.detail : d.salla.detail)}</span>
        <span class="badge ${d.webhookSecret ? "" : "warn"}">Webhook secret: ${d.webhookSecret ? "✓" : "—"}</span>`;
    } catch (err) {
      out.innerHTML = `<span class="badge off">${esc(err.message)}</span>`;
    }
  };

  const disconnectBtn = body.querySelector("#disconnectBtn");
  if (disconnectBtn) disconnectBtn.onclick = async () => {
    await api("/salla/disconnect", { method: "POST" });
    settingsView();
  };

  body.querySelector("#pwBtn").onclick = async () => {
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current: body.querySelector("#pwCur").value,
          next: body.querySelector("#pwNew").value,
        }),
      });
      alert(t("passwordChanged"));
      state.token = "";
      localStorage.removeItem("sc_token");
      route();
    } catch (err) {
      notice(body.querySelector("#pwMsg"), "err", err.message);
    }
  };
}

// ---------------------------------------------------------------- router

async function route() {
  setLangAttrs();
  let status;
  try {
    status = await fetch("/auth/status", {
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
    }).then((r) => r.json());
  } catch {
    $app.innerHTML = `<div class="auth-wrap"><div class="card auth-card"><p>Server unreachable.</p></div></div>`;
    return;
  }
  state.status = status;

  if (!status.setup) return authView(true);
  if (!status.authenticated) return authView(false);

  try { state.agents = await api("/agents"); } catch { state.agents = []; }

  const [, view = "dashboard", param] = location.hash.replace(/^#\//, "").split("/").length
    ? ["", ...location.hash.replace(/^#\//, "").split("/")]
    : ["", "dashboard"];

  try {
    if (view === "reports") await reportsView(param);
    else if (view === "chat") await chatView(param);
    else if (view === "managers") await managersView();
    else if (view === "settings") await settingsView();
    else await dashboardView();
  } catch (err) {
    const main = document.getElementById("main") || $app;
    main.insertAdjacentHTML("beforeend", `<div class="notice err">${esc(err.message)}</div>`);
  }
}

window.addEventListener("hashchange", route);
route();
