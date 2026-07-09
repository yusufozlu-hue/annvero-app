-- ANNVERO Knowledge Engine / Muhasebe Bilgi Motoru — Görev 1
-- Tablolar, indexler, RLS, sınırlı global seed
-- Idempotent; company_id text (companies.id ile uyumlu)
-- Önkoşul: 015_security_phase1.sql (annvero_can_access_company fonksiyonları)

-- ---------------------------------------------------------------------------
-- Yardımcı: global veya firma kapsamlı okuma
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_can_read_row(
  p_is_global boolean,
  p_company_id text
)
returns boolean
language sql
stable
as $$
  select
    (
      coalesce(p_is_global, false) = true
      and (p_company_id is null or btrim(p_company_id) = '')
    )
    or (
      p_company_id is not null
      and btrim(p_company_id) <> ''
      and public.annvero_can_access_company(p_company_id)
    )
    or public.annvero_is_admin_or_partner();
$$;

create or replace function public.knowledge_can_write_row(
  p_is_global boolean,
  p_company_id text
)
returns boolean
language sql
stable
as $$
  select
    case
      when p_company_id is not null and btrim(p_company_id) <> '' then
        public.annvero_can_access_company(p_company_id)
      when coalesce(p_is_global, false) = true then
        public.annvero_is_management()
      else
        public.annvero_is_management()
    end;
$$;

-- ---------------------------------------------------------------------------
-- A) knowledge_entities
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_entities (
  id uuid primary key default gen_random_uuid(),
  entity_name text not null,
  entity_family text,
  entity_type text,
  aliases jsonb not null default '[]'::jsonb,
  tax_no text,
  iban_list jsonb not null default '[]'::jsonb,
  swift_codes jsonb not null default '[]'::jsonb,
  country text default 'TR',
  risk_level text not null default 'low',
  default_confidence numeric not null default 0.70,
  is_global boolean not null default true,
  company_id text,
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

create index if not exists idx_knowledge_entities_entity_name
  on public.knowledge_entities (entity_name);

create index if not exists idx_knowledge_entities_entity_family
  on public.knowledge_entities (entity_family);

create index if not exists idx_knowledge_entities_entity_type
  on public.knowledge_entities (entity_type);

create index if not exists idx_knowledge_entities_company_id
  on public.knowledge_entities (company_id)
  where company_id is not null and btrim(company_id) <> '';

create index if not exists idx_knowledge_entities_active
  on public.knowledge_entities (is_active, deleted_at)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- B) knowledge_match_patterns
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_match_patterns (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.knowledge_entities(id) on delete set null,
  company_id text,
  pattern_type text not null,
  pattern_value text not null,
  normalized_value text,
  priority integer not null default 100,
  confidence numeric not null default 0.75,
  is_global boolean not null default true,
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

create index if not exists idx_knowledge_patterns_entity_id
  on public.knowledge_match_patterns (entity_id);

create index if not exists idx_knowledge_patterns_company_id
  on public.knowledge_match_patterns (company_id)
  where company_id is not null and btrim(company_id) <> '';

create index if not exists idx_knowledge_patterns_type_value
  on public.knowledge_match_patterns (pattern_type, pattern_value);

create index if not exists idx_knowledge_patterns_normalized
  on public.knowledge_match_patterns (normalized_value)
  where normalized_value is not null;

-- ---------------------------------------------------------------------------
-- C) knowledge_accounting_rules
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_accounting_rules (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.knowledge_entities(id) on delete set null,
  company_id text,
  source_type text,
  transaction_direction text default 'both',
  debit_account_code text,
  debit_account_name text,
  credit_account_code text,
  credit_account_name text,
  vat_account_code text,
  vat_rate numeric,
  document_type text,
  cari_name text,
  description_template text,
  voucher_type text,
  rule_source text not null default 'knowledge_base',
  priority integer not null default 100,
  confidence numeric not null default 0.80,
  risk_level text not null default 'low',
  is_global boolean not null default true,
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

create index if not exists idx_knowledge_rules_entity_id
  on public.knowledge_accounting_rules (entity_id);

create index if not exists idx_knowledge_rules_company_id
  on public.knowledge_accounting_rules (company_id)
  where company_id is not null and btrim(company_id) <> '';

create index if not exists idx_knowledge_rules_source_type
  on public.knowledge_accounting_rules (source_type);

create index if not exists idx_knowledge_rules_confidence
  on public.knowledge_accounting_rules (confidence desc);

-- ---------------------------------------------------------------------------
-- D) knowledge_company_memory
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_company_memory (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  entity_id uuid references public.knowledge_entities(id) on delete set null,
  raw_description text,
  normalized_description text,
  bank_name text,
  account_no text,
  iban text,
  counterparty_name text,
  transaction_type text,
  currency text default 'TRY',
  amount_min numeric,
  amount_max numeric,
  suggested_account_code text,
  suggested_account_name text,
  suggested_counter_account_code text,
  suggested_cari text,
  suggested_document_type text,
  suggested_description text,
  suggested_vat_rate numeric,
  confidence numeric not null default 1.00,
  learned_from text not null default 'manual',
  use_count integer not null default 0,
  last_used_at timestamptz,
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

create index if not exists idx_knowledge_memory_company_norm_desc
  on public.knowledge_company_memory (company_id, normalized_description);

create index if not exists idx_knowledge_memory_company_raw_desc
  on public.knowledge_company_memory (company_id, raw_description);

create index if not exists idx_knowledge_memory_company_id
  on public.knowledge_company_memory (company_id);

create index if not exists idx_knowledge_memory_entity_id
  on public.knowledge_company_memory (entity_id)
  where entity_id is not null;

-- ---------------------------------------------------------------------------
-- E) knowledge_decision_history
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_decision_history (
  id uuid primary key default gen_random_uuid(),
  company_id text,
  source_type text,
  source_record_id text,
  raw_input jsonb not null default '{}'::jsonb,
  matched_entity_id uuid,
  matched_pattern_id uuid,
  matched_rule_id uuid,
  decision_source text not null,
  decision_status text not null default 'suggested',
  confidence numeric not null default 0,
  suggested_result jsonb not null default '{}'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_decisions_company_id
  on public.knowledge_decision_history (company_id)
  where company_id is not null and btrim(company_id) <> '';

create index if not exists idx_knowledge_decisions_source
  on public.knowledge_decision_history (decision_source);

create index if not exists idx_knowledge_decisions_confidence
  on public.knowledge_decision_history (confidence desc);

create index if not exists idx_knowledge_decisions_created_at
  on public.knowledge_decision_history (created_at desc);

-- ---------------------------------------------------------------------------
-- F) knowledge_rule_versions
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_rule_versions (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  version_no integer not null,
  change_type text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);

create unique index if not exists idx_knowledge_versions_record_version
  on public.knowledge_rule_versions (table_name, record_id, version_no);

create index if not exists idx_knowledge_versions_record
  on public.knowledge_rule_versions (table_name, record_id);

create index if not exists idx_knowledge_versions_changed_at
  on public.knowledge_rule_versions (changed_at desc);

-- ---------------------------------------------------------------------------
-- RLS — knowledge_entities
-- ---------------------------------------------------------------------------

alter table public.knowledge_entities enable row level security;

drop policy if exists "knowledge_entities_select" on public.knowledge_entities;
drop policy if exists "knowledge_entities_insert" on public.knowledge_entities;
drop policy if exists "knowledge_entities_update" on public.knowledge_entities;

create policy "knowledge_entities_select"
  on public.knowledge_entities for select to authenticated
  using (
    deleted_at is null
    and public.knowledge_can_read_row(is_global, company_id)
  );

create policy "knowledge_entities_insert"
  on public.knowledge_entities for insert to authenticated
  with check (public.knowledge_can_write_row(is_global, company_id));

create policy "knowledge_entities_update"
  on public.knowledge_entities for update to authenticated
  using (public.knowledge_can_write_row(is_global, company_id))
  with check (public.knowledge_can_write_row(is_global, company_id));

-- ---------------------------------------------------------------------------
-- RLS — knowledge_match_patterns
-- ---------------------------------------------------------------------------

alter table public.knowledge_match_patterns enable row level security;

drop policy if exists "knowledge_patterns_select" on public.knowledge_match_patterns;
drop policy if exists "knowledge_patterns_insert" on public.knowledge_match_patterns;
drop policy if exists "knowledge_patterns_update" on public.knowledge_match_patterns;

create policy "knowledge_patterns_select"
  on public.knowledge_match_patterns for select to authenticated
  using (
    deleted_at is null
    and public.knowledge_can_read_row(is_global, company_id)
  );

create policy "knowledge_patterns_insert"
  on public.knowledge_match_patterns for insert to authenticated
  with check (public.knowledge_can_write_row(is_global, company_id));

create policy "knowledge_patterns_update"
  on public.knowledge_match_patterns for update to authenticated
  using (public.knowledge_can_write_row(is_global, company_id))
  with check (public.knowledge_can_write_row(is_global, company_id));

-- ---------------------------------------------------------------------------
-- RLS — knowledge_accounting_rules
-- ---------------------------------------------------------------------------

alter table public.knowledge_accounting_rules enable row level security;

drop policy if exists "knowledge_rules_select" on public.knowledge_accounting_rules;
drop policy if exists "knowledge_rules_insert" on public.knowledge_accounting_rules;
drop policy if exists "knowledge_rules_update" on public.knowledge_accounting_rules;

create policy "knowledge_rules_select"
  on public.knowledge_accounting_rules for select to authenticated
  using (
    deleted_at is null
    and public.knowledge_can_read_row(is_global, company_id)
  );

create policy "knowledge_rules_insert"
  on public.knowledge_accounting_rules for insert to authenticated
  with check (public.knowledge_can_write_row(is_global, company_id));

create policy "knowledge_rules_update"
  on public.knowledge_accounting_rules for update to authenticated
  using (public.knowledge_can_write_row(is_global, company_id))
  with check (public.knowledge_can_write_row(is_global, company_id));

-- ---------------------------------------------------------------------------
-- RLS — knowledge_company_memory (her zaman firma kapsamlı)
-- ---------------------------------------------------------------------------

alter table public.knowledge_company_memory enable row level security;

drop policy if exists "knowledge_memory_select" on public.knowledge_company_memory;
drop policy if exists "knowledge_memory_insert" on public.knowledge_company_memory;
drop policy if exists "knowledge_memory_update" on public.knowledge_company_memory;

create policy "knowledge_memory_select"
  on public.knowledge_company_memory for select to authenticated
  using (
    deleted_at is null
    and public.annvero_can_access_company(company_id)
  );

create policy "knowledge_memory_insert"
  on public.knowledge_company_memory for insert to authenticated
  with check (public.annvero_can_access_company(company_id));

create policy "knowledge_memory_update"
  on public.knowledge_company_memory for update to authenticated
  using (public.annvero_can_access_company(company_id))
  with check (public.annvero_can_access_company(company_id));

-- ---------------------------------------------------------------------------
-- RLS — knowledge_decision_history
-- ---------------------------------------------------------------------------

alter table public.knowledge_decision_history enable row level security;

drop policy if exists "knowledge_decisions_select" on public.knowledge_decision_history;
drop policy if exists "knowledge_decisions_insert" on public.knowledge_decision_history;

create policy "knowledge_decisions_select"
  on public.knowledge_decision_history for select to authenticated
  using (
    (company_id is null or btrim(company_id) = '')
    or public.annvero_can_access_company(company_id)
    or public.annvero_is_admin_or_partner()
  );

create policy "knowledge_decisions_insert"
  on public.knowledge_decision_history for insert to authenticated
  with check (
    (company_id is null or btrim(company_id) = '' or public.annvero_can_access_company(company_id))
  );

-- ---------------------------------------------------------------------------
-- RLS — knowledge_rule_versions (yönetim okur; yazma API/service_role)
-- ---------------------------------------------------------------------------

alter table public.knowledge_rule_versions enable row level security;

drop policy if exists "knowledge_versions_select" on public.knowledge_rule_versions;
drop policy if exists "knowledge_versions_insert" on public.knowledge_rule_versions;

create policy "knowledge_versions_select"
  on public.knowledge_rule_versions for select to authenticated
  using (public.annvero_is_management());

create policy "knowledge_versions_insert"
  on public.knowledge_rule_versions for insert to authenticated
  with check (public.annvero_is_management());

comment on table public.knowledge_entities is
  'Muhasebe Bilgi Motoru — tanınabilir kurum/varlık kayıtları (global + firma).';
comment on table public.knowledge_match_patterns is
  'Entity eşleştirme kalıpları (keyword, regex, IBAN, VKN, vb.).';
comment on table public.knowledge_accounting_rules is
  'Entity/pattern için muhasebe öneri kuralları.';
comment on table public.knowledge_company_memory is
  'Firma bazlı öğrenilen muhasebe hafızası.';
comment on table public.knowledge_decision_history is
  'Knowledge Engine karar geçmişi — audit_events ile tamamlayıcı.';
comment on table public.knowledge_rule_versions is
  'Bilgi tabloları versiyon geçmişi (soft delete öncesi snapshot).';

-- ---------------------------------------------------------------------------
-- Seed — sınırlı global örnekler (idempotent sabit UUID)
-- ---------------------------------------------------------------------------

do $$
declare
  v_google uuid := 'a1000001-0001-4000-8000-000000000001';
  v_meta uuid := 'a1000001-0001-4000-8000-000000000002';
  v_sgk uuid := 'a1000001-0001-4000-8000-000000000003';
  v_gib uuid := 'a1000001-0001-4000-8000-000000000004';
  v_turkcell uuid := 'a1000001-0001-4000-8000-000000000005';
  v_turktelekom uuid := 'a1000001-0001-4000-8000-000000000006';
  v_booking uuid := 'a1000001-0001-4000-8000-000000000007';
  v_expedia uuid := 'a1000001-0001-4000-8000-000000000008';
begin
  if to_regclass('public.knowledge_entities') is null then
    raise notice '017 skip seed: knowledge_entities yok';
    return;
  end if;

  insert into public.knowledge_entities (
    id, entity_name, entity_family, entity_type, aliases, country,
    risk_level, default_confidence, is_global, is_active
  ) values
    (v_google, 'Google', 'tech_ads', 'platform',
      '["Google","Google Ads","GOOGLE ADS","Google Ireland"]'::jsonb, 'IE', 'low', 0.70, true, true),
    (v_meta, 'Meta', 'tech_ads', 'platform',
      '["Facebook","Meta","Meta Ads","FACEBK"]'::jsonb, 'US', 'low', 0.70, true, true),
    (v_sgk, 'SGK', 'public_institution', 'government',
      '["SGK","Sosyal Güvenlik","5510"]'::jsonb, 'TR', 'low', 0.85, true, true),
    (v_gib, 'GİB', 'public_institution', 'government',
      '["GİB","GIB","Gelir İdaresi","gelir idaresi"]'::jsonb, 'TR', 'medium', 0.85, true, true),
    (v_turkcell, 'Turkcell', 'telecom', 'corporation',
      '["Turkcell","TURKCELL","TCELL"]'::jsonb, 'TR', 'low', 0.75, true, true),
    (v_turktelekom, 'Türk Telekom', 'telecom', 'corporation',
      '["Türk Telekom","Turk Telekom","TTNET","AVEA"]'::jsonb, 'TR', 'low', 0.75, true, true),
    (v_booking, 'Booking.com', 'travel_ota', 'platform',
      '["Booking","Booking.com","BOOKING.COM"]'::jsonb, 'NL', 'low', 0.70, true, true),
    (v_expedia, 'Expedia', 'travel_ota', 'platform',
      '["Expedia","EXPEDIA","Hotels.com"]'::jsonb, 'US', 'low', 0.70, true, true)
  on conflict (id) do nothing;

  -- Patterns
  insert into public.knowledge_match_patterns (
    id, entity_id, pattern_type, pattern_value, normalized_value, priority, confidence, is_global
  ) values
    ('b2000001-0001-4000-8000-000000000001', v_google, 'keyword', 'GOOGLE', 'google', 10, 0.80, true),
    ('b2000001-0001-4000-8000-000000000002', v_google, 'description_contains', 'GOOGLE ADS', 'google ads', 20, 0.78, true),
    ('b2000001-0001-4000-8000-000000000003', v_meta, 'keyword', 'FACEBK', 'facebk', 10, 0.80, true),
    ('b2000001-0001-4000-8000-000000000004', v_meta, 'description_contains', 'META ADS', 'meta ads', 20, 0.78, true),
    ('b2000001-0001-4000-8000-000000000005', v_sgk, 'keyword', 'SGK', 'sgk', 10, 0.90, true),
    ('b2000001-0001-4000-8000-000000000006', v_gib, 'keyword', 'GİB', 'gib', 10, 0.88, true),
    ('b2000001-0001-4000-8000-000000000007', v_turkcell, 'keyword', 'TURKCELL', 'turkcell', 10, 0.82, true),
    ('b2000001-0001-4000-8000-000000000008', v_turktelekom, 'keyword', 'TURK TELEKOM', 'turk telekom', 10, 0.82, true),
    ('b2000001-0001-4000-8000-000000000009', v_booking, 'keyword', 'BOOKING', 'booking', 10, 0.80, true),
    ('b2000001-0001-4000-8000-000000000010', v_expedia, 'keyword', 'EXPEDIA', 'expedia', 10, 0.80, true)
  on conflict (id) do nothing;

  -- Örnek muhasebe kuralları (düşük confidence — kesin hesap kodu değil)
  insert into public.knowledge_accounting_rules (
    id, entity_id, source_type, transaction_direction,
    debit_account_code, debit_account_name, credit_account_code, credit_account_name,
    document_type, description_template, rule_source, priority, confidence, risk_level, is_global
  ) values
    (
      'c3000001-0001-4000-8000-000000000001', v_google, 'credit_card', 'debit',
      '770', 'Genel Yönetim Giderleri', '320', 'Satıcılar',
      'EA', 'örnek global kural — Google Ads reklam gideri (hesap kodları doğrulanmalı)',
      'global', 100, 0.45, 'medium', true
    ),
    (
      'c3000001-0001-4000-8000-000000000002', v_meta, 'credit_card', 'debit',
      '770', 'Genel Yönetim Giderleri', '320', 'Satıcılar',
      'EA', 'örnek global kural — Meta/Facebook Ads reklam gideri (hesap kodları doğrulanmalı)',
      'global', 100, 0.45, 'medium', true
    ),
    (
      'c3000001-0001-4000-8000-000000000003', v_sgk, 'payroll', 'debit',
      '335', 'Personele Borçlar', '102', 'Bankalar',
      'DK', 'örnek global kural — SGK prim ödemesi (hesap kodları doğrulanmalı)',
      'global', 100, 0.50, 'medium', true
    ),
    (
      'c3000001-0001-4000-8000-000000000004', v_booking, 'bank', 'debit',
      '120', 'Alıcılar', '600', 'Yurt İçi Satışlar',
      'EA', 'örnek global kural — Booking komisyon/satış (hesap kodları doğrulanmalı)',
      'global', 100, 0.40, 'high', true
    )
  on conflict (id) do nothing;

  raise notice '017 seed: global knowledge entities/patterns/rules yüklendi (veya zaten vardı)';
end;
$$;
