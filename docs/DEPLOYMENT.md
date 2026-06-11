# Deployment & Salla App Store Listing

## Requirements

- Node.js 20+ (22 recommended)
- A stable HTTPS domain (required for Salla webhooks and App Store review)
- ~256 MB RAM; disk for `DATA_DIR`

## Deploy

```bash
git clone <repo> && cd <repo>
npm ci
npm run build
PORT=3000 DATA_DIR=/var/lib/store-council npm start
```

Run under a supervisor (systemd example):

```ini
[Unit]
Description=Store Council
After=network.target

[Service]
WorkingDirectory=/opt/store-council
ExecStart=/usr/bin/node dist/server.js
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/store-council
Restart=always
User=storecouncil

[Install]
WantedBy=multi-user.target
```

The server handles `SIGTERM`/`SIGINT` gracefully (stops the cron task, closes connections).

Put a reverse proxy (Caddy/Nginx) in front for TLS. Caddy example:

```
council.example.com {
    reverse_proxy localhost:3000
}
```

> **HTTPS is mandatory in production** — the owner token, API keys, and Salla tokens travel over this connection.

### Docker (optional)

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm ci
COPY . .
RUN npm run build
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

## Data & backups

All state lives in `DATA_DIR` as JSON files (atomic writes): `settings`, `auth`, `salla-tokens`, `store-info`, `webhook-events`, `daily-reports`, `chat-history`. Back up the directory; restoring it restores the installation. No database needed.

## Environment variables (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `DATA_DIR` | `./data` | State directory |
| `ANTHROPIC_API_KEY` | — | Initial default; editable in dashboard |
| `OPENROUTER_API_KEY` | — | Initial default; editable in dashboard |
| `SALLA_CLIENT_ID` / `SALLA_CLIENT_SECRET` / `SALLA_REDIRECT_URI` / `SALLA_WEBHOOK_SECRET` | — | Initial defaults; editable in dashboard |
| `DAILY_CRON` | `0 5 * * *` | Initial schedule default |

## Salla App Store listing checklist

In the [Salla Partners portal](https://salla.partners), for your app:

1. **Webhook URL** → `https://<your-domain>/webhooks/salla`, security strategy **Signature**. Copy the secret into *Dashboard → Settings → Webhook secret*.
2. **Subscribe** to events: `app.store.authorize`, `app.installed`, `app.uninstalled` (required), plus store events you want in the feed (`order.created`, `product.updated`, `review.added`, `abandoned.cart`, `customer.created`, …).
3. **Scopes**: request **read-only** scopes only. The app never writes to stores — state this in your review notes; it simplifies approval.
4. **OAuth callback** → `https://<your-domain>/auth/salla/callback` (used for non-App-Store installs and development).
5. App metadata: name (e.g. «مجلس المتجر»), Arabic + English descriptions, screenshots of the dashboard/report/chat, support contact, pricing plan.
6. Before submitting: run *Settings → System check* (all green), then install the draft app on a demo store and verify the `app.store.authorize` flow connects automatically.

### How Easy Mode works here

When a merchant installs the listed app, Salla sends `app.store.authorize` with access/refresh tokens to the webhook. The platform verifies the signature, stores the tokens, and the store shows as **Connected via Salla App Store** — the merchant never sees an OAuth screen. `app.uninstalled` immediately disconnects and clears cached store identity.

## Updating

```bash
git pull && npm ci && npm run build && systemctl restart store-council
```

Settings files are forward-compatible: new settings fields pick up defaults automatically (`getSettings()` merges over defaults).
