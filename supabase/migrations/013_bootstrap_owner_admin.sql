-- Kurulum sahibi: yusufozlu@gmail.com → admin rolü
-- company_ids boş = tüm firmalara erişim (admin/partner kuralı)

update public.annvero_user_profiles
set
  role = 'admin',
  permissions = '["view","edit","export","approve","admin"]'::jsonb,
  company_ids = '[]'::jsonb,
  is_active = true,
  updated_at = now()
where lower(email) = lower('yusufozlu@gmail.com');
