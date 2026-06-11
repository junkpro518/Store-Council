# 03 — Database Schema (PostgreSQL)

Every current `JsonStore` maps to a table (or a `kv_state` row). All tenant tables carry `store_id uuid not null references stores(id)` and an index on it. Timestamps are `timestamptz`.

## Core tenancy

```sql
create table stores (
  id                 uuid primary key default gen_random_uuid(),
  platform           text not null default 'salla',          -- future: 'zid'
  salla_merchant_id  bigint unique,
  name               text not null default '',
  domain             text not null default '',
  status             text not null default 'trial',          -- trial|active|past_due|locked|uninstalled
  trial_ends_at      timestamptz,
  uninstalled_at     timestamptz,                            -- starts 90-day retention countdown
  created_at         timestamptz not null default now()
);

create table accounts (                                       -- merchant users (05)
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  password_hash text,                                         -- null when Salla-OAuth only
  salla_user_id bigint unique,
  created_at    timestamptz not null default now()
);

create table account_stores (                                 -- one account can own several stores
  account_id uuid references accounts(id) on delete cascade,
  store_id   uuid references stores(id) on delete cascade,
  role       text not null default 'owner',                   -- owner|staff (staff = read+chat only)
  primary key (account_id, store_id)
);

create table sessions (
  token       text primary key,
  account_id  uuid not null references accounts(id) on delete cascade,
  expires_at  timestamptz not null
);

create table integration_tokens (                             -- MCP / API access
  token      text primary key,
  store_id   uuid not null references stores(id) on delete cascade,
  created_at timestamptz not null default now()
);
```

## Salla connection & per-tenant config

```sql
create table salla_tokens (
  store_id      uuid primary key references stores(id) on delete cascade,
  access_token  text not null,                                -- encrypted (05)
  refresh_token text not null,                                -- encrypted
  expires_at    timestamptz not null,
  mode          text not null default 'easy'                  -- easy|oauth
);

-- Per-tenant settings: same shape as today's PlatformSettings minus AI keys
-- and Salla app credentials (both move to platform config).
create table store_settings (
  store_id    uuid primary key references stores(id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb,             -- language, storeContext, schedule prefs,
  version     int  not null default 1                         --   topActionsCount, agents overrides…
);
```

## Agent state (the learning system)

```sql
create table agent_memories (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references stores(id) on delete cascade,
  agent_id   text not null,
  type       text not null check (type in ('lesson','fact','feedback')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index on agent_memories (store_id, agent_id, created_at desc);

create table chat_messages (
  id         bigint generated always as identity primary key,
  store_id   uuid not null references stores(id) on delete cascade,
  agent_id   text not null,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index on chat_messages (store_id, agent_id, id desc);
```

## Reports, actions, achievements

```sql
create table reports (
  store_id    uuid not null references stores(id) on delete cascade,
  date        date not null,
  started_at  timestamptz not null,
  finished_at timestamptz not null,
  summary     text not null,
  departments jsonb not null default '{}'::jsonb,             -- agentId -> findings text
  primary key (store_id, date)
);

create table actions (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references stores(id) on delete cascade,
  report_date      date not null,
  idx              int  not null,                             -- order within report
  manager          text not null,
  title            text not null,
  what             text not null, why text not null, how text not null, impact text not null,
  priority         int  not null,
  status           text not null default 'new',               -- new|done|dismissed
  status_changed_at timestamptz,
  measured_at      timestamptz,
  measured_impact  text,
  foreign key (store_id, report_date) references reports(store_id, date) on delete cascade
);
create index on actions (store_id, status, status_changed_at);  -- impact-loop due query
```

## Metrics, events, board

```sql
create table metrics_snapshots (
  store_id        uuid not null references stores(id) on delete cascade,
  date            date not null,
  orders          int, customers int, products int, abandoned_carts int,
  primary key (store_id, date)
);

create table webhook_events (
  id          bigint generated always as identity primary key,
  store_id    uuid references stores(id) on delete set null,  -- null = unrouted/app-level
  event       text not null,
  summary     text not null,
  received_at timestamptz not null default now()
);
create index on webhook_events (store_id, id desc);

-- Council board is ephemeral per daily run; kv_state is fine, or:
create table board_notes (
  store_id uuid not null references stores(id) on delete cascade,
  date     date not null,
  agent_id text not null,
  content  text not null,
  at       timestamptz not null default now()
);
create index on board_notes (store_id, date);
```

## Billing & usage (04, 07)

```sql
create table subscriptions (
  store_id     uuid primary key references stores(id) on delete cascade,
  plan         text not null,                                  -- basic|pro|growth|byok
  salla_sub_id text,
  status       text not null,                                  -- active|past_due|canceled|expired
  started_at   timestamptz, renews_at timestamptz, canceled_at timestamptz,
  raw          jsonb                                           -- last webhook payload for audit
);

create table usage_ledger (
  id            bigint generated always as identity primary key,
  store_id      uuid not null references stores(id) on delete cascade,
  date          date not null,
  kind          text not null,                                 -- daily_analysis|chat|impact|curator|mcp
  model         text not null,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0
);
create index on usage_ledger (store_id, date);
```

## Jobs (02)

```sql
create table jobs (
  id         bigint generated always as identity primary key,
  store_id   uuid not null references stores(id) on delete cascade,
  type       text not null,                                    -- daily_analysis|impact_measurement|curator_run
  run_at     timestamptz not null,
  state      text not null default 'queued',                   -- queued|running|done|failed
  attempts   int  not null default 0,
  locked_by  text, locked_at timestamptz,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on jobs (state, run_at);
create unique index one_daily_per_store_per_day
  on jobs (store_id, type, (run_at::date)) where type = 'daily_analysis' and state in ('queued','running');
```

## Catch-all for low-churn blobs

```sql
create table kv_state (                                        -- store-info cache, curator state, misc
  store_id uuid not null references stores(id) on delete cascade,
  kind     text not null,
  value    jsonb not null,
  version  int not null default 1,
  primary key (store_id, kind)
);
```

## Mapping table: today's JsonStore → target

| JsonStore name | Target |
|---|---|
| `settings` | `store_settings` (minus AI keys/app creds → platform config) |
| `auth` | `accounts` + `sessions` + `integration_tokens` |
| `salla-tokens` | `salla_tokens` |
| `store-info` | `kv_state(kind='store_info')` |
| `webhook-events` | `webhook_events` |
| `daily-reports` | `reports` + `actions` |
| `chat-history` | `chat_messages` |
| `agent-memory` | `agent_memories` |
| `council-board` | `board_notes` (or `kv_state`) |
| `metrics-history` | `metrics_snapshots` |
| `curator-state` | `kv_state(kind='curator')` |

## Row-level security (optional hardening, recommended on Supabase)

Enable RLS on all tenant tables with `using (store_id = current_setting('app.current_store')::uuid)`; web/worker set `app.current_store` per request/job. The application-level `TenantStore` contract is the primary guard; RLS catches bugs.

## Retention & deletion

- `uninstalled` tenants: full data retained 90 days (re-install restores everything — a selling point), then a purge job hard-deletes by `store_id` cascade.
- Owner-initiated deletion (GDPR-style/PDPL): immediate cascade delete endpoint in the admin module + confirmation flow.
