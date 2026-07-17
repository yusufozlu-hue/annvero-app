-- ANNVERO — company_ids geçiş inceleme raporu (SALT-OKUNUR / YALNIZCA SELECT)
-- ---------------------------------------------------------------------------
-- Amac: user_metadata.company_ids (GÜVENİLMEZ claim) ile annvero_company_members
--       (güvenli membership) kayıtlarını kullanıcı bazında YAN YANA göstermek.
--
-- KURALLAR:
--   - Hicbir INSERT/UPDATE/DELETE/DDL YOKTUR. Yalnız SELECT.
--   - user_metadata.company_ids değerleri OTOMATİK KOPYALANMAZ (güvenilmez kaynak).
--   - Token/secret gösterilmez; yalnız e-posta, rol ve company_id listeleri.
--   - Production'da güvenle çalıştırılabilir (yan etkisiz).
--
-- Yorum: untrusted_claim_company_ids ile secure_membership_company_ids farkı,
--        elle (admin onayıyla) membership'e taşınması gereken erişimleri gösterir.
-- ---------------------------------------------------------------------------

with claim as (
  -- auth.users.raw_user_meta_data içindeki (güvenilmez) company_ids
  select
    u.id as user_id,
    lower(u.email) as email,
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
    ) as ignored_app_metadata_company_ids
  from auth.users u
),
membership as (
  -- güvenli membership (annvero_company_members)
  select
    m.user_id,
    array_agg(m.company_id order by m.company_id) filter (where m.is_active) as secure_membership_company_ids
  from public.annvero_company_members m
  group by m.user_id
),
prof as (
  select
    p.auth_user_id,
    p.role,
    p.is_active,
    coalesce(
      (
        select array_agg(v order by v)
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(p.company_ids) = 'array' then p.company_ids
            else '[]'::jsonb
          end
        ) as v
      ),
      array[]::text[]
    ) as profile_company_ids
  from public.annvero_user_profiles p
)
select
  claim.email,
  prof.role,
  prof.is_active as profile_active,
  claim.untrusted_claim_company_ids,
  claim.ignored_app_metadata_company_ids,
  prof.profile_company_ids,
  coalesce(membership.secure_membership_company_ids, array[]::text[]) as secure_membership_company_ids,
  case
    when prof.role in ('admin', 'partner') then 'admin/partner — kısa devre (membership gerekmez)'
    when coalesce(array_length(membership.secure_membership_company_ids, 1), 0) = 0
         and coalesce(array_length(claim.untrusted_claim_company_ids, 1), 0) > 0
      then 'DİKKAT: claim var, membership yok — admin onayıyla membership eklenmeli'
    when coalesce(array_length(membership.secure_membership_company_ids, 1), 0) = 0
      then 'fail-closed — sıfır firma (membership yok)'
    else 'membership mevcut'
  end as migration_note
from claim
left join prof on prof.auth_user_id = claim.user_id
left join membership on membership.user_id = claim.user_id
order by claim.email;
