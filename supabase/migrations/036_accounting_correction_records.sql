-- ANNVERO Genel Muhasebe — düzeltme fişi uygulama takibi (036)
-- Forward-only, idempotent. Ham Excel/ledger içeriği saklanmaz.
-- Yazma: service_role (API). Okuma: authenticated + annvero_can_access_company.

create table if not exists public.accounting_correction_records (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  source_period text not null default '',
  source_voucher_no text not null default '',
  source_voucher_date date,
  source_document_no text not null default '',
  finding_code text not null default '',
  recipe_code text not null default '',
  wrong_account_code text not null default '',
  wrong_debit numeric(18, 2) not null default 0,
  wrong_credit numeric(18, 2) not null default 0,
  correction_account_code text not null default '',
  correction_account_name text not null default '',
  correction_date date,
  correction_period text not null default '',
  correction_debit numeric(18, 2) not null default 0,
  correction_credit numeric(18, 2) not null default 0,
  exported_file_name text not null default '',
  source_fingerprint text not null default '',
  status text not null default 'EXPORTED'
    check (status in ('EXPORTED', 'APPLIED', 'CANCELLED')),
  external_system text not null default 'LUCA',
  external_voucher_no text,
  external_voucher_date date,
  applied_at timestamptz,
  applied_by text,
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.accounting_correction_records is
  'Genel muhasebe düzeltme fişi export/uygulama takibi. Vendor-neutral external_* alanları.';

create unique index if not exists uq_accounting_correction_records_active_fingerprint
  on public.accounting_correction_records (company_id, source_fingerprint)
  where status in ('EXPORTED', 'APPLIED')
    and source_fingerprint <> '';

create index if not exists idx_accounting_correction_records_company_status
  on public.accounting_correction_records (company_id, status, created_at desc);

create index if not exists idx_accounting_correction_records_company_fingerprint
  on public.accounting_correction_records (company_id, source_fingerprint);

create index if not exists idx_accounting_correction_records_company_source_fis
  on public.accounting_correction_records (company_id, source_voucher_no, created_at desc);

create or replace function public.accounting_correction_records_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_accounting_correction_records_set_updated_at
  on public.accounting_correction_records;
create trigger trg_accounting_correction_records_set_updated_at
before update on public.accounting_correction_records
for each row execute function public.accounting_correction_records_set_updated_at();

alter table public.accounting_correction_records enable row level security;

revoke all on public.accounting_correction_records from anon;
revoke insert, update, delete on public.accounting_correction_records from authenticated;
grant select on public.accounting_correction_records to authenticated;
grant all on public.accounting_correction_records to service_role;

drop policy if exists "accounting_correction_records_select_member"
  on public.accounting_correction_records;
create policy "accounting_correction_records_select_member"
  on public.accounting_correction_records
  for select
  to authenticated
  using (public.annvero_can_access_company(company_id));

do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'annvero_ensure_restrictive_deny_policy'
      and pg_function_is_visible(oid)
  ) then
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'accounting_correction_records',
      'accounting_correction_records_deny_insert', 'INSERT'
    );
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'accounting_correction_records',
      'accounting_correction_records_deny_update', 'UPDATE'
    );
    perform public.annvero_ensure_restrictive_deny_policy(
      'public', 'accounting_correction_records',
      'accounting_correction_records_deny_delete', 'DELETE'
    );
  end if;
end $$;
