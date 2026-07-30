-- ANNVERO E-Defter Kontrol Merkezi — kalıcı özet / bulgu / denetim (028)
-- Forward-only, idempotent. Destructive SQL YOK.
-- Ham XML/ZIP, belge satırı, IBAN, tam VKN/MERSİS saklanmaz; yalnız güvenli özet.
-- Yazma: service_role (API). Okuma: authenticated + annvero_can_access_company (fail-closed).

-- ---------------------------------------------------------------------------
-- 1) edefter_control_runs
-- ---------------------------------------------------------------------------

create table if not exists public.edefter_control_runs (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  period text not null default '',
  status text not null default 'completed'
    check (status in ('running', 'completed', 'failed', 'superseded', 'deleted')),
  engine_version text not null,
  source_fingerprint text not null default '',
  journal_fingerprint text not null default '',
  ledger_fingerprint text not null default '',
  document_types jsonb not null default '[]'::jsonb,
  document_count integer not null default 0 check (document_count >= 0),
  row_count integer not null default 0 check (row_count >= 0),
  opening_balance_summary jsonb not null default '{}'::jsonb,
  closing_balance_summary jsonb not null default '{}'::jsonb,
  reconciliation_status text not null default 'skipped'
    check (reconciliation_status in ('matched', 'mismatched', 'skipped', 'partial')),
  reconciliation_summary jsonb not null default '{}'::jsonb,
  severity_counts jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision >= 1),
  supersedes_run_id uuid references public.edefter_control_runs(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_by text not null default '',
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.edefter_control_runs is
  'E-Defter kontrol koşusu güvenli özeti. Ham XML/ZIP/belge içeriği yok.';

create unique index if not exists uq_edefter_control_runs_idempotent
  on public.edefter_control_runs (company_id, source_fingerprint, engine_version)
  where deleted_at is null
    and source_fingerprint <> ''
    and status <> 'deleted';

create index if not exists idx_edefter_control_runs_company_period
  on public.edefter_control_runs (company_id, period, created_at desc)
  where deleted_at is null;

create index if not exists idx_edefter_control_runs_company_status
  on public.edefter_control_runs (company_id, status, created_at desc)
  where deleted_at is null;

create index if not exists idx_edefter_control_runs_company_engine
  on public.edefter_control_runs (company_id, engine_version, created_at desc)
  where deleted_at is null;

create index if not exists idx_edefter_control_runs_supersedes
  on public.edefter_control_runs (supersedes_run_id)
  where supersedes_run_id is not null;

create or replace function public.edefter_control_runs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_edefter_control_runs_set_updated_at on public.edefter_control_runs;
create trigger trg_edefter_control_runs_set_updated_at
before update on public.edefter_control_runs
for each row execute function public.edefter_control_runs_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) edefter_control_findings
-- ---------------------------------------------------------------------------

create table if not exists public.edefter_control_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.edefter_control_runs(id),
  company_id text not null,
  code text not null default '',
  severity text not null default 'info',
  category text not null default '',
  safe_reference text not null default '',
  summary text not null default '',
  occurrence_count integer not null default 1 check (occurrence_count >= 0),
  resolution_status text not null default 'open'
    check (resolution_status in ('open', 'resolved', 'accepted', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  deleted_at timestamptz,
  deleted_by text
);

comment on table public.edefter_control_findings is
  'E-Defter bulguları — yalnız güvenli özet/referans; satır içeriği yok.';

create index if not exists idx_edefter_control_findings_run
  on public.edefter_control_findings (run_id)
  where deleted_at is null;

create index if not exists idx_edefter_control_findings_company
  on public.edefter_control_findings (company_id, resolution_status, created_at desc)
  where deleted_at is null;

create index if not exists idx_edefter_control_findings_company_code
  on public.edefter_control_findings (company_id, code)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3) edefter_control_audit_events
-- ---------------------------------------------------------------------------

create table if not exists public.edefter_control_audit_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.edefter_control_runs(id),
  company_id text not null,
  event_type text not null,
  actor_id text not null default '',
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.edefter_control_audit_events is
  'E-Defter denetim olayları. safe_metadata allowlist; ham belge yok.';

create index if not exists idx_edefter_control_audit_run
  on public.edefter_control_audit_events (run_id, created_at desc);

create index if not exists idx_edefter_control_audit_company
  on public.edefter_control_audit_events (company_id, created_at desc);

create index if not exists idx_edefter_control_audit_type
  on public.edefter_control_audit_events (company_id, event_type, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS — fail-closed yazma; okuma üyelik tabanlı
-- ---------------------------------------------------------------------------

alter table public.edefter_control_runs enable row level security;
alter table public.edefter_control_findings enable row level security;
alter table public.edefter_control_audit_events enable row level security;

revoke all on public.edefter_control_runs from anon;
revoke all on public.edefter_control_findings from anon;
revoke all on public.edefter_control_audit_events from anon;

revoke insert, update, delete on public.edefter_control_runs from authenticated;
revoke insert, update, delete on public.edefter_control_findings from authenticated;
revoke insert, update, delete on public.edefter_control_audit_events from authenticated;

grant select on public.edefter_control_runs to authenticated;
grant select on public.edefter_control_findings to authenticated;
grant select on public.edefter_control_audit_events to authenticated;

grant all on public.edefter_control_runs to service_role;
grant all on public.edefter_control_findings to service_role;
grant all on public.edefter_control_audit_events to service_role;

drop policy if exists "edefter_control_runs_select_member" on public.edefter_control_runs;
create policy "edefter_control_runs_select_member"
  on public.edefter_control_runs
  for select
  to authenticated
  using (
    deleted_at is null
    and public.annvero_can_access_company(company_id)
  );

drop policy if exists "edefter_control_findings_select_member" on public.edefter_control_findings;
create policy "edefter_control_findings_select_member"
  on public.edefter_control_findings
  for select
  to authenticated
  using (
    deleted_at is null
    and public.annvero_can_access_company(company_id)
  );

drop policy if exists "edefter_control_audit_select_member" on public.edefter_control_audit_events;
create policy "edefter_control_audit_select_member"
  on public.edefter_control_audit_events
  for select
  to authenticated
  using (public.annvero_can_access_company(company_id));

-- Restrictive deny: authenticated yazamaz (API service_role kullanır)
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'annvero_ensure_restrictive_deny_policy'
      and pg_function_is_visible(oid)
  ) then
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'edefter_control_runs', 'edefter_control_runs_deny_insert', 'INSERT'
    );
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'edefter_control_runs', 'edefter_control_runs_deny_update', 'UPDATE'
    );
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'edefter_control_runs', 'edefter_control_runs_deny_delete', 'DELETE'
    );
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'edefter_control_findings', 'edefter_control_findings_deny_insert', 'INSERT'
    );
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'edefter_control_findings', 'edefter_control_findings_deny_update', 'UPDATE'
    );
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'edefter_control_findings', 'edefter_control_findings_deny_delete', 'DELETE'
    );
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'edefter_control_audit_events', 'edefter_control_audit_deny_insert', 'INSERT'
    );
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'edefter_control_audit_events', 'edefter_control_audit_deny_update', 'UPDATE'
    );
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'edefter_control_audit_events', 'edefter_control_audit_deny_delete', 'DELETE'
    );
  end if;
end $$;
