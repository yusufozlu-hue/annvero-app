-- ANNVERO PRODUCTION forward-only paketi (020 -> 023) — TASLAK
-- Yalniz production'da uygulanmamis migrationlar:
--   020 cloud_storage (Google Drive V1)
--   021 learning_memory legacy public policy temizligi (idempotent)
--   022 RBAC profil kaynagi + service_role grantlari
--   023 company membership (company_ids TEK kaynak = annvero_company_members)
--
-- ONEMLI:
--  * ONCE scripts/migrations/production/preflight_production_readonly.sql calistirilmali.
--  * 023 uygulaninca normal (admin/partner disi) kullanicilar firma erisimini KAYBEDER
--    (membership tablosu bos). Ayni bakim penceresinde ADMIN ONAYLI membership seed sart:
--    report_company_membership_migration.sql -> admin onayi -> annvero_sync_company_membership RPC.
--  * user_metadata.company_ids OTOMATIK guvenilir kabul EDILMEZ.
--  * PRODUCTION bootstrap 001-023 KULLANILMAZ; yalniz bu forward-only paket kullanilir.
--  * Tek transaction: hata olursa TAMAMI rollback.
--  * Bu dosya SECRET icermez.

BEGIN;

-- === BEGIN MIGRATION: 020_cloud_storage_evrak_havuzu_v1.sql ===
-- ANNVERO Google Drive / Evrak Havuzu V1
-- Uygulama erişimi yalnız server-side service_role üzerinden yapılır.

create table if not exists public.cloud_storage_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'google_drive'),
  account_email text,
  access_scope text not null default 'https://www.googleapis.com/auth/drive.file',
  token_reference text,
  status text not null default 'disconnected' check (status in ('connected','disconnected','error')),
  connected_at timestamptz,
  last_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.company_cloud_folders (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  connection_id uuid references public.cloud_storage_connections(id) on delete set null,
  root_folder_id text not null,
  root_folder_name text,
  folder_structure_version text not null default 'v1',
  sync_status text not null default 'idle' check (sync_status in ('idle','syncing','ok','error','disconnected')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id),
  unique (connection_id, root_folder_id)
);

create table if not exists public.document_index (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  provider text not null default 'google_drive' check (provider = 'google_drive'),
  provider_file_id text not null,
  parent_folder_id text,
  file_name text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  file_hash text,
  document_category text,
  document_type text,
  period_key text,
  revision_no integer not null default 0 check (revision_no >= 0),
  source_path text,
  parse_status text not null default 'indexed',
  parser_version text,
  normalized_record_id text,
  last_modified_at timestamptz,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider_file_id)
);

create table if not exists public.document_sync_events (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  provider_file_id text,
  event_type text not null,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_document_index_company_hash
  on public.document_index (company_id, file_hash)
  where file_hash is not null and file_hash <> '' and parse_status <> 'soft_deleted';
create index if not exists idx_cloud_connections_user on public.cloud_storage_connections(user_id, provider);
create index if not exists idx_cloud_folders_company on public.company_cloud_folders(company_id);
create index if not exists idx_document_index_company_period on public.document_index(company_id, period_key);
create index if not exists idx_document_sync_events_company on public.document_sync_events(company_id, created_at desc);

alter table public.cloud_storage_connections enable row level security;
alter table public.company_cloud_folders enable row level security;
alter table public.document_index enable row level security;
alter table public.document_sync_events enable row level security;

-- Fail-closed: anon/authenticated için policy yok; service_role RLS bypass eder.
revoke all on public.cloud_storage_connections from anon, authenticated;
revoke all on public.company_cloud_folders from anon, authenticated;
revoke all on public.document_index from anon, authenticated;
revoke all on public.document_sync_events from anon, authenticated;

create or replace function public.cloud_storage_set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_cloud_connections_updated_at on public.cloud_storage_connections;
create trigger trg_cloud_connections_updated_at before update on public.cloud_storage_connections
for each row execute function public.cloud_storage_set_updated_at();
drop trigger if exists trg_company_cloud_folders_updated_at on public.company_cloud_folders;
create trigger trg_company_cloud_folders_updated_at before update on public.company_cloud_folders
for each row execute function public.cloud_storage_set_updated_at();
drop trigger if exists trg_document_index_updated_at on public.document_index;
create trigger trg_document_index_updated_at before update on public.document_index
for each row execute function public.cloud_storage_set_updated_at();

comment on column public.cloud_storage_connections.token_reference is
  'AES-256-GCM encrypted OAuth token bundle; plaintext token yasaktır.';
-- === END MIGRATION: 020_cloud_storage_evrak_havuzu_v1.sql ===

-- === BEGIN MIGRATION: 021_security_cleanup_legacy_learning_memory_policies.sql ===
-- ANNVERO Güvenlik — legacy learning_memory public policy temizliği
-- 015 daha önce production'da uygulanmış olsa bile, eski açık (public) policy'lerin
-- kalıcı temizliğini garanti eder. Idempotent ve fail-safe.
-- - learning_memory yoksa notice verip güvenle atlar.
-- - Tablo veya veri SİLMEZ; yalnızca policy düşürür.
-- - RLS'yi açık bırakır.

do $$
begin
  if to_regclass('public.learning_memory') is null then
    raise notice '021 skip: public.learning_memory yok';
    return;
  end if;

  execute 'alter table public.learning_memory enable row level security';

  execute 'drop policy if exists "allow learning memory delete" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory insert" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory read" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory update" on public.learning_memory';

  raise notice '021: legacy learning_memory public policy temizliği tamamlandı';
end $$;
-- === END MIGRATION: 021_security_cleanup_legacy_learning_memory_policies.sql ===

-- === BEGIN MIGRATION: 022_rbac_profile_source_and_table_grants.sql ===
-- ANNVERO RBAC güvenlik düzeltmesi (022) — kalıcı ve en küçük güvenli düzeltme
-- ---------------------------------------------------------------------------
-- SORUN:
--   annvero_jwt_role() rol yetkisini auth.jwt() -> user_metadata alanından okuyordu.
--   user_metadata KULLANICI TARAFINDAN DEĞİŞTİRİLEBİLİR bir alandır; bu nedenle bir
--   kullanıcı kendi user_metadata.annvero_role='admin' yaparak yetki yükseltebilirdi
--   (privilege escalation). Ayrıca gerçek oturumda user_metadata boş olduğu için
--   admin profil sahibi kullanıcı bile companies listesini boş ([]) görüyordu.
--
-- ÇÖZÜM:
--   Rol, auth kimliği (JWT email claim'i) ile annvero_user_profiles tablosundan,
--   SECURITY DEFINER + sabit search_path'li bir fonksiyon üzerinden okunur.
--   app_metadata yalnız SERVER-CONTROLLED fallback olarak kabul edilir.
--   user_metadata admin/partner yetkisi için ARTIK KULLANILMAZ.
--
-- NOT (company_ids):
--   annvero_jwt_company_ids() bu migration'da DEĞİŞTİRİLMEDİ (mevcut davranış korunur).
--   Ancak company_ids hâlâ user_metadata'dan okunuyor; bu da bir güven sınırı riskidir
--   (bkz. rapor). admin/partner için company_ids etkisizdir çünkü rol kısa devre yapar.
--
-- Idempotent; geçmiş migration'lar yeniden yazılmadan üzerine eklenir.
-- ---------------------------------------------------------------------------

-- 1) Aktif kullanıcının rolünü profil tablosundan güvenli oku (SECURITY DEFINER).
--    Definer sayesinde annvero_user_profiles RLS'ine takılmadan okur; recursion olmaz.
create or replace function public.annvero_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.annvero_user_profiles p
  where p.is_active = true
    and lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by p.updated_at desc nulls last
  limit 1;
$$;

comment on function public.annvero_profile_role() is
  'Aktif kullanıcının rolünü annvero_user_profiles tablosundan (JWT email kimliği ile) güvenli okur. SECURITY DEFINER, sabit search_path.';

-- 2) annvero_jwt_role(): rol kaynağı = profil tablosu (birincil) + app_metadata (server fallback).
--    user_metadata GÜVENİLMEZ olduğundan tamamen çıkarıldı.
create or replace function public.annvero_jwt_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(public.annvero_profile_role(), ''),
    -- Server-controlled fallback: app_metadata kullanıcı tarafından değiştirilemez.
    nullif(auth.jwt() -> 'app_metadata' ->> 'annvero_role', ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    ''
  );
$$;

comment on function public.annvero_jwt_role() is
  'Rol kaynağı: annvero_user_profiles (birincil) + app_metadata (server fallback). user_metadata GÜVENİLMEZ ve rol için kullanılmaz.';

-- 3) companies: authenticated için EN DAR tablo grant'i.
--    Statik inceleme: firma listesi tarayıcıda authenticated ile SELECT edilir
--    (src/utils/companies.js). Yazma işlemleri (upsert/update/soft-delete) yalnız
--    server service_role ile yapılır (app/api/companies/route.js). Bu nedenle
--    authenticated'a INSERT/UPDATE/DELETE VERİLMEZ; yalnız SELECT verilir.
grant select on public.companies to authenticated;

-- RLS zaten açık kalır; satır erişimi companies_select_authenticated policy'si ile
-- annvero_can_access_company(id) üzerinden (artık güvenli rol kaynağıyla) yönetilir.

-- 4) service_role: sunucu API'leri için tam yetki (42501 permission denied giderilir).
--    Migration'la (postgres owner) oluşturulan tablolarda service_role otomatik
--    yetki almadığı için server route'ları 42501 alıyordu. Aşağıdaki grant'ler
--    idempotent'tir; tekrar çalıştırmak güvenlidir. anon/authenticated rollerine
--    EK geniş yetki VERİLMEZ; authenticated için companies yalnız SELECT kalır.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Gelecekte (migration sahibi = postgres tarafından) oluşturulacak public nesneler
-- için varsayılan yetkiler. Yalnız service_role hedeflenir.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
-- === END MIGRATION: 022_rbac_profile_source_and_table_grants.sql ===

-- === BEGIN MIGRATION: 023_company_membership_source.sql ===
-- ANNVERO Güvenlik (023) — company_ids yatay yetki yükseltme açığının kalıcı kapatılması
-- ---------------------------------------------------------------------------
-- SORUN:
--   annvero_jwt_company_ids() firma erişim listesini auth.jwt() -> user_metadata
--   -> company_ids alanından okuyordu. user_metadata KULLANICI TARAFINDAN
--   DEĞİŞTİRİLEBİLİR olduğundan, normal (admin olmayan) bir kullanıcı kendi
--   user_metadata.company_ids değerine başka firmaların ID'lerini ekleyerek
--   YATAY YETKİ YÜKSELTME (unauthorized firma erişimi) yapabilirdi.
--
-- ÇÖZÜM (fail-closed):
--   Firma üyeliği güvenilir, sunucu-kontrollü bir DB tablosuna (annvero_company_members)
--   taşınır. Runtime authorization auth.uid() tabanlıdır. user_metadata rol/company_ids
--   kaynağı olarak ARTIK KULLANILMAZ. Membership kaydı olmayan normal kullanıcı
--   fail-closed olarak SIFIR firma görür. admin/partner kısa devresi korunur.
--
--   Firma satır yetkisinin TEK kaynağı annvero_company_members'tir. user_metadata VE
--   app_metadata company_ids yetki kaynağı DEĞİLDİR (app_metadata fallback kaldırıldı).
--   Membership senkronu yalnız atomik SECURITY DEFINER RPC (annvero_sync_company_membership)
--   üzerinden, yalnız service_role ile yapılır.
--
-- Idempotent; geçmiş migration'lar yeniden yazılmadan üzerine eklenir.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Kimlik eşlemesi: annvero_user_profiles.auth_user_id
-- ===========================================================================

-- 1) auth_user_id kolonu (yoksa ekle)
alter table public.annvero_user_profiles
  add column if not exists auth_user_id uuid;

-- 2) Idempotent backfill — birincil: auth.users ile lower(email) eşleşmesi.
update public.annvero_user_profiles p
set auth_user_id = u.id
from auth.users u
where p.auth_user_id is null
  and lower(p.email) = lower(u.email);

-- 2b) Güvenli ek backfill — uygulama zaten profiles.id = auth user uuid yazıyor
--     (bkz. profileService.js). Cast hatası riski OLMADAN auth.users ile metin
--     eşleşmesi (p.id = u.id::text) kullanılır; profiles.id üzerinde uuid cast YAPILMAZ.
update public.annvero_user_profiles p
set auth_user_id = u.id
from auth.users u
where p.auth_user_id is null
  and p.id = u.id::text;

-- 3) auth_user_id için unique partial index (null olmayanlar)
create unique index if not exists uq_annvero_user_profiles_auth_user_id
  on public.annvero_user_profiles (auth_user_id)
  where auth_user_id is not null;

-- 4) auth.users(id) FK — mevcut veri riskine karşı NOT VALID ekle, sonra validate et.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'annvero_user_profiles_auth_user_id_fkey'
      and conrelid = 'public.annvero_user_profiles'::regclass
  ) then
    alter table public.annvero_user_profiles
      add constraint annvero_user_profiles_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id)
      on delete set null
      not valid;
  end if;

  begin
    alter table public.annvero_user_profiles
      validate constraint annvero_user_profiles_auth_user_id_fkey;
  exception when others then
    raise notice '023: auth_user_id FK validate atlandı (mevcut veri): %', sqlerrm;
  end;
end $$;

-- 5) annvero_profile_role(): runtime kaynağı auth.uid() = auth_user_id (yalnız).
--    Email eşleşmesi runtime yetki kaynağı DEĞİLDİR (yalnız yukarıdaki backfill'de kullanıldı).
--    022'deki email-tabanlı sürümün üstüne yazar; user_metadata kesinlikle kullanılmaz.
create or replace function public.annvero_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.annvero_user_profiles p
  where p.is_active = true
    and p.auth_user_id = auth.uid()
  order by p.updated_at desc nulls last
  limit 1;
$$;

comment on function public.annvero_profile_role() is
  'Aktif kullanıcının rolünü annvero_user_profiles tablosundan auth.uid() = auth_user_id ile okur (runtime). SECURITY DEFINER, sabit search_path. user_metadata KULLANILMAZ.';

-- ===========================================================================
-- B) Normalize firma üyeliği: public.annvero_company_members
-- ===========================================================================

create table if not exists public.annvero_company_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id text not null references public.companies(id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id)
);

create index if not exists idx_annvero_company_members_user
  on public.annvero_company_members (user_id)
  where is_active;

create index if not exists idx_annvero_company_members_company
  on public.annvero_company_members (company_id);

-- updated_at trigger
create or replace function public.annvero_company_members_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_annvero_company_members_set_updated_at on public.annvero_company_members;

create trigger trg_annvero_company_members_set_updated_at
before update on public.annvero_company_members
for each row
execute function public.annvero_company_members_set_updated_at();

-- RLS aç; anon/authenticated için POLICY veya GRANT VERİLMEZ (fail-closed).
-- Normal kullanıcı tabloyu doğrudan okuyamaz; yalnız SECURITY DEFINER erişim
-- fonksiyonu (annvero_profile_company_ids) üzerinden erişilir. service_role RLS'i bypass eder.
alter table public.annvero_company_members enable row level security;

-- Emniyet: yanlışlıkla eklenmiş açık policy'ler varsa kaldır (idempotent).
drop policy if exists "annvero_company_members_authenticated_all" on public.annvero_company_members;
drop policy if exists "annvero_company_members_select_authenticated" on public.annvero_company_members;

-- service_role için gerekli CRUD (idempotent, dar hedef).
grant select, insert, update, delete on public.annvero_company_members to service_role;

-- Emniyet: anon/authenticated'a tablo yetkisi verilmediğini garanti et.
revoke all on public.annvero_company_members from anon;
revoke all on public.annvero_company_members from authenticated;

comment on table public.annvero_company_members is
  'Kullanıcı-firma üyeliği (güvenilir, sunucu-kontrollü). RLS açık; anon/authenticated erişimi yok. Yalnız service_role ve SECURITY DEFINER fonksiyonları erişir.';

-- B.1) Atomik membership senkron RPC'si.
--   - Verilen geçerli company ID'lerini aktif upsert eder.
--   - Listede olmayan mevcut üyelikleri is_active=false yapar.
--   - Geçersiz company_id (companies FK ihlali) → fonksiyon exception atar → TÜM işlem rollback.
--   - Tek statement (RPC) çağrısı olduğundan atomiktir.
--   - Yalnız service_role çağırabilir; anon/authenticated execute REVOKE edilir.
create or replace function public.annvero_sync_company_membership(
  target_user_id uuid,
  target_company_ids text[],
  actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids text[];
begin
  if target_user_id is null then
    raise exception 'annvero_sync_company_membership: target_user_id zorunludur';
  end if;

  -- Normalize: null/boş temizle, tekilleştir.
  v_ids := (
    select coalesce(array_agg(distinct btrim(x)), array[]::text[])
    from unnest(coalesce(target_company_ids, array[]::text[])) as x
    where btrim(coalesce(x, '')) <> ''
  );

  -- 1) İstenen listede olmayan mevcut aktif üyelikleri pasifleştir (erişim daraltma).
  update public.annvero_company_members m
  set is_active = false, updated_at = now()
  where m.user_id = target_user_id
    and m.is_active = true
    and m.company_id <> all(v_ids);

  -- 2) İstenen firmaları aktif upsert et. Geçersiz company_id → FK ihlali → rollback.
  if array_length(v_ids, 1) is not null then
    insert into public.annvero_company_members as m
      (user_id, company_id, is_active, created_by, updated_at)
    select target_user_id, cid, true, actor_user_id, now()
    from unnest(v_ids) as cid
    on conflict (user_id, company_id)
    do update set is_active = true, updated_at = now();
  end if;
end;
$$;

comment on function public.annvero_sync_company_membership(uuid, text[], uuid) is
  'Atomik membership senkronu (service_role). Geçersiz company_id → tüm işlem rollback. anon/authenticated execute YOK.';

-- Execute yetkisi: yalnız service_role.
revoke all on function public.annvero_sync_company_membership(uuid, text[], uuid) from public;
revoke all on function public.annvero_sync_company_membership(uuid, text[], uuid) from anon;
revoke all on function public.annvero_sync_company_membership(uuid, text[], uuid) from authenticated;
grant execute on function public.annvero_sync_company_membership(uuid, text[], uuid) to service_role;

-- ===========================================================================
-- C) Güvenli company_ids kaynağı
-- ===========================================================================

-- 1) auth.uid() ile aktif membership company_id listesi (text[]).
create or replace function public.annvero_profile_company_ids()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(m.company_id), array[]::text[])
  from public.annvero_company_members m
  where m.is_active = true
    and m.user_id = auth.uid();
$$;

comment on function public.annvero_profile_company_ids() is
  'auth.uid() için aktif firma üyeliği company_id listesi. SECURITY DEFINER; annvero_company_members RLS bypass. user_metadata KULLANILMAZ.';

-- 2) annvero_jwt_company_ids(): firma satır yetkisinin TEK kaynağı DB membership.
--    user_metadata VE app_metadata company_ids yetki kaynağı DEĞİLDİR (ikisi de kaldırıldı).
--    Membership yoksa her zaman boş text[] döner (fail-closed).
create or replace function public.annvero_jwt_company_ids()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.annvero_profile_company_ids();
$$;

comment on function public.annvero_jwt_company_ids() is
  'Firma erişim listesi: TEK kaynak annvero_company_members (auth.uid). Membership yoksa boş text[] (fail-closed). user_metadata ve app_metadata company_ids KULLANILMAZ.';

-- 3) annvero_can_access_company(): admin/partner kısa devresi korunur; normal kullanıcı
--    yeni güvenli membership kaynağını (annvero_jwt_company_ids) kullanır. Membership yoksa
--    fail-closed (sıfır firma). Yalnız comment/search_path güncellendi; mantık korunur.
create or replace function public.annvero_can_access_company(target_company_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  role text;
  ids text[];
begin
  if auth.uid() is null then
    return false;
  end if;

  if target_company_id is null or btrim(target_company_id) = '' then
    return false;
  end if;

  role := public.annvero_jwt_role();

  if role in ('admin', 'partner') then
    return true;
  end if;

  ids := public.annvero_jwt_company_ids();

  if coalesce(array_length(ids, 1), 0) = 0 then
    return false;
  end if;

  return target_company_id = any(ids);
end;
$$;

comment on function public.annvero_can_access_company(text) is
  'Firma erişim kontrolü. Rol kaynağı: annvero_user_profiles (auth.uid). Firma listesi: annvero_company_members (auth.uid). user_metadata KULLANILMAZ. Membership yoksa fail-closed.';
-- === END MIGRATION: 023_company_membership_source.sql ===

COMMIT;
