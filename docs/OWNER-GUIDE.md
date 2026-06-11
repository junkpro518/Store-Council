# Owner Guide — دليل صاحب المتجر

Everything in Store Council is managed from the dashboard in your browser. You never need to edit code or files.

## البدء السريع (Quick start in Arabic)

1. افتح رابط المنصة في المتصفح، وعند أول تشغيل اختر **كلمة مرور المالك** (٨ أحرف على الأقل).
2. من **الإعدادات → الذكاء الاصطناعي**: ألصق مفتاح OpenRouter (openrouter.ai/keys) واختر النموذج.
3. من **الإعدادات → ربط متجر سلة**: أدخل بيانات تطبيقك من بوابة شركاء سلة ثم اضغط **ربط المتجر**. (إذا كان التطبيق منشوراً في متجر تطبيقات سلة، يتم الربط تلقائياً عند التثبيت.)
4. من **لوحة المتابعة** اضغط **تشغيل التحليل الآن** لأول تقرير، أو انتظر الموعد اليومي (الافتراضي ٥ فجراً بتوقيت الرياض).
5. تحدث مع أي مدير من صفحة **تحدث مع المدراء** — بالعربية أو الإنجليزية.

---

## First-run setup

1. **Owner password** — the first screen asks you to create it (min 8 characters). Keep it safe; it protects your store data and API keys. You can change it later in *Settings → Security* (changing it signs out all devices).
2. **AI key** (*Settings → AI*) — the platform runs on **OpenRouter**: paste a key from openrouter.ai/keys and type any tool-calling model id from openrouter.ai/models (e.g. `openai/gpt-4o` or `anthropic/claude-sonnet-4.5`). One key, every model, one bill.
3. **Connect your store** (*Settings → Salla*):
   - Installed from the **Salla App Store**? Connection happens automatically the moment you install — nothing to do.
   - Otherwise: create an app at salla.partners with **read-only scopes**, set its callback URL to the one shown in Settings, paste Client ID/Secret, click **Connect store**.
   - Paste the **webhook secret** from the Partners portal so store events flow in securely.
4. Click **System check** in Settings — all three badges should be green.

## The daily report

Every day at the scheduled time, all enabled managers analyze your store and the General Manager hands you one report:

- **Action list** — ranked recommendations. Each one tells you **What** to do, **Why** (with your store's actual numbers), **How** (exact steps in the Salla dashboard), and the **expected impact**. Mark items **done** when you implement them, or **dismiss** what doesn't fit — your progress is tracked per report.
- **Full report** — the executive summary and watchlist.
- **Department findings** — each manager's complete analysis, expandable.

Use **Run analysis now** any time; the daily schedule is configurable (*Settings → Daily analysis*): time (cron), timezone, number of actions, and how many managers work in parallel.

> **The platform never changes your store.** Every recommendation is yours to implement — that's why each comes with step-by-step instructions.

## Chatting with managers

Open *Chat with Managers*, pick a manager, and ask anything — in Arabic or English. Managers read your live store data while answering and may consult each other (e.g. the Pricing Manager checking shipping costs with the Logistics Manager). Each manager keeps their own conversation history; clear it any time.

Good questions to try:
- «لماذا اقترحتِ رفع سعر المنتج الفلاني؟» (to the manager credited on an action)
- "Which products should I put on offer for the next campaign?"
- «ما أكثر سبب لإلغاء الطلبات هذا الشهر؟»

## Customizing your team (*Managers* page)

For every manager you can:
- **Enable/disable** — disabled managers skip the daily analysis and can't be chatted with. (The General Manager is always on.)
- **Rename** — call your Pricing Manager whatever you like.
- **Standing instructions** — permanent guidance, e.g. *"Never suggest discounts above 20%"* or «اهتم بقسم العطور أولاً».
- **Focus areas** — replace what the manager watches daily (one per line; empty = defaults).

Also write a **store profile** in *Settings → Tell the managers about your store* — your niche, goals, and constraints. Every manager reads it before every analysis and chat.

## Housekeeping

- **Backups** — all your data (settings, reports, chats, tokens) lives in the platform's data folder; your host should back it up. Deleting it factory-resets the platform.
- **Recent store events** — the dashboard shows live events (new orders, reviews, abandoned carts) arriving from Salla webhooks.
- **Troubleshooting** — run *Settings → System check* first. It tells you exactly which of the three things is broken: the AI key, the Salla connection, or the webhook secret.
