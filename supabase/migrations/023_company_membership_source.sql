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
