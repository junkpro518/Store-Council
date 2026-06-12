-- 002_audit.sql — audit trail for operator actions (T025) and account email
-- uniqueness relaxation (multiple null emails are fine; salla_user_id is the key).

begin;

create table audit_log (
  id        bigint generated always as identity primary key,
  store_id  uuid references stores(id) on delete set null,
  actor     text not null,                 -- 'admin' | account id | 'system'
  action    text not null,                 -- 'impersonate' | 'purge' | 'plan_override' | ...
  detail    jsonb not null default '{}'::jsonb,
  at        timestamptz not null default now()
);
create index on audit_log (store_id, id desc);

commit;
