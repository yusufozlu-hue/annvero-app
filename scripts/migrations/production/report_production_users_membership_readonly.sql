-- ANNVERO PRODUCTION — kullanici / profil / membership gecis raporu
-- YALNIZCA SELECT (READ-ONLY). Hicbir INSERT/UPDATE/DELETE/DDL/GRANT YOKTUR.
-- ===========================================================================
-- AMAC (uygulama sirasindaki yeri: preflight'tan SONRA, atomik migration'dan ONCE):
--   023 uygulaninca firma erisiminin TEK kaynagi annvero_company_members olur.
--   Bu rapor, admin'in membership seed'ini GUVENLE planlamasi icin gereken
--   girdiyi verir: mevcut auth kullanicilari, tasidiklari (GUVENILMEZ)
--   user_metadata.company_ids claim'leri ve bunlarin gercek companies ile eslesip
--   eslesmedigi.
--
-- FAIL-SAFE TASARIM (kritik):
--   Bu dosya, migration UYGULANMADAN ONCE de calisabilmelidir. O anda
--   annvero_user_profiles ve annvero_company_members tablolari HENUZ YOKTUR.
--   PostgreSQL statik tablo referanslarini PLAN asamasinda cozumler; bu yuzden
--   bu rapor o (henuz olmayan) tablolara STATIK REFERANS VERMEZ. Yalniz her zaman
--   var olan auth.users + public.companies + KATALOG (to_regclass, pg_class,
--   information_schema) kullanilir.
--
--   Migration SONRASI profil/membership yan-yana karsilastirmasi icin:
--     scripts/migrations/production/verify_drive_rbac_production.sql (dogrulama) ve
--     scripts/migrations/staging/report_company_membership_migration.sql (yan-yana)
--   kullanilir; ikisi de tablolar OLUSTUKTAN sonra guvenle statik referans verir.
--
-- GUVENLIK KURALLARI (rapor):
--   - user_metadata.company_ids OTOMATIK GUVENILIR KABUL EDILMEZ; yalniz gosterilir.
--   - admin/partner rolu OTOMATIK TAHMIN EDILMEZ (bu rapor rol atamaz).
--   - Token/secret gosterilmez; yalniz e-posta, kimlik, claim id listeleri ve tarihler.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0) Migration durumu (KATALOG) — hangi hedef tablolarin var oldugunu gosterir.
--    Rapor bloklarinin hangilerinin anlamli oldugunu belirlemek icin okuyun.
-- ---------------------------------------------------------------------------
select
  (to_regclass('public.annvero_user_profiles')  is not null) as profiles_table_present,
  (to_regclass('public.annvero_company_members') is not null) as members_table_present,
  (to_regclass('public.companies')              is not null) as companies_table_present,
  (
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'annvero_user_profiles'
        and column_name = 'auth_user_id'
    )
  ) as profiles_auth_user_id_present,
  (select count(*)::bigint from auth.users)     as auth_users_total,
  (select count(*)::bigint from public.companies) as companies_total;

-- ---------------------------------------------------------------------------
-- 1) Kullanici bazinda gecis raporu (yalniz auth.users + companies + katalog).
--    - untrusted_claim_company_ids: user_metadata.company_ids (GUVENILMEZ) claim.
--    - ignored_app_metadata_company_ids: app_metadata.company_ids (023 sonrasi da
--      yetki kaynagi DEGILDIR; yalniz gorunurluk icin).
--    - unknown_company_ids_in_claim: claim'de gecen ama public.companies'te BULUNMAYAN
--      firma id'leri (seed sirasinda gecersiz -> FK ihlali -> RPC rollback riski).
--    - suggested_action: SADECE oneri; otomatik uygulanmaz. admin karar verir.
-- ---------------------------------------------------------------------------
with company_ids as (
  select array(
    select id::text from public.companies
  ) as all_company_ids
),
claim as (
  select
    u.id as auth_user_id,
    lower(u.email) as email,
    u.created_at as user_created_at,
    u.last_sign_in_at,
    (u.email_confirmed_at is not null) as email_confirmed,
    coalesce(
      (
        select array_agg(v order by v)
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(u.raw_user_meta_data -> 'company_ids') = 'array'
              then u.raw_user_meta_data -> 'company_ids'
            else '[]'::jsonb
          end
        ) as v
      ),
      array[]::text[]
    ) as untrusted_claim_company_ids,
    coalesce(
      (
        select array_agg(v order by v)
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(u.raw_app_meta_data -> 'company_ids') = 'array'
              then u.raw_app_meta_data -> 'company_ids'
            else '[]'::jsonb
          end
        ) as v
      ),
      array[]::text[]
    ) as ignored_app_metadata_company_ids,
    -- user_metadata icindeki (GUVENILMEZ) rol ipucu — yalniz gorunurluk, atama YOK.
    coalesce(
      nullif(u.raw_user_meta_data ->> 'annvero_role', ''),
      nullif(u.raw_user_meta_data ->> 'role', '')
    ) as untrusted_user_metadata_role_hint
  from auth.users u
)
select
  claim.email,
  claim.auth_user_id,
  claim.email_confirmed,
  claim.user_created_at,
  claim.last_sign_in_at,
  claim.untrusted_user_metadata_role_hint,
  claim.untrusted_claim_company_ids,
  claim.ignored_app_metadata_company_ids,
  -- claim'deki, companies'te BULUNMAYAN id'ler (seed'de gecersiz olur):
  coalesce(
    array(
      select cid
      from unnest(claim.untrusted_claim_company_ids) as cid
      -- company_ids CTE'sini cross join ile array IFADESI olarak getir; boylece
      -- gecerli "text <> ALL(text[])" array karsilastirmasi kullanilir (subquery
      -- formu DEGIL). Bos dizi -> ALL vacuously true -> id "bilinmeyen" sayilir.
      cross join company_ids ci
      where cid <> all (ci.all_company_ids)
    ),
    array[]::text[]
  ) as unknown_company_ids_in_claim,
  case
    when claim.untrusted_user_metadata_role_hint in ('admin', 'partner')
      then 'INCELE: user_metadata admin/partner ipucu var — OTOMATIK GUVENILMEZ. '
           || 'Admin, profil rolunu ELLE dogrulamali (annvero_user_profiles). Membership gerekmez.'
    when coalesce(array_length(claim.untrusted_claim_company_ids, 1), 0) > 0
      then 'INCELE: normal kullanici claim firma id tasiyor — OTOMATIK KOPYALANMAZ. '
           || 'Admin onayiyla annvero_sync_company_membership ile ekle (gecersiz id''leri cikar).'
    else 'BILGI: claim yok — fail-closed (sifir firma). Erisim gerekiyorsa admin onayiyla membership ekle.'
  end as suggested_action_admin_review_required
from claim
order by claim.email;

-- ---------------------------------------------------------------------------
-- 2) Ozet sayaçlar (yalniz auth.users) — planlama olcegi.
-- ---------------------------------------------------------------------------
select
  count(*)::bigint as auth_users_total,
  count(*) filter (
    where jsonb_typeof(raw_user_meta_data -> 'company_ids') = 'array'
      and jsonb_array_length(raw_user_meta_data -> 'company_ids') > 0
  )::bigint as users_with_untrusted_company_ids,
  count(*) filter (
    where coalesce(
      nullif(raw_user_meta_data ->> 'annvero_role', ''),
      nullif(raw_user_meta_data ->> 'role', '')
    ) in ('admin', 'partner')
  )::bigint as users_with_untrusted_admin_partner_hint,
  count(*) filter (where last_sign_in_at is not null)::bigint as users_signed_in_at_least_once
from auth.users;
