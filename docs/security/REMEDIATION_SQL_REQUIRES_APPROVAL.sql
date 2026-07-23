-- AÇIK ONAY GEREKİYOR — production/staging'e otomatik uygulanmaz.
-- Bu dosya, policy sıkılaştırması sırasında dikkatli inceleme gerektiren
-- remediation SQL adaylarını belgeler. Destructive değildir ama davranış değiştirir.
--
-- Kullanım: DBA/yönetici onayı + staging tatbikatı sonrası manuel uygulama.

-- Örnek: Eski geniş authenticated write policy'leri hâlâ varsa (erken migration kalıntısı)
-- aşağıdaki komutlar yalnızca policy drop eder; veri silmez.
--
-- NOT: Önce mevcut policy listesini Supabase SQL editor'de doğrulayın:
--   select schemaname, tablename, policyname, cmd, roles
--   from pg_policies
--   where schemaname = 'public'
--   order by tablename, policyname;

-- drop policy if exists "reconciliation_matches_authenticated_all" on public.reconciliation_matches;
-- drop policy if exists "official_notifications_authenticated_all" on public.official_notifications;
-- drop policy if exists "company_gib_credentials_authenticated_all" on public.company_gib_credentials;
-- drop policy if exists "learning_memory_authenticated_all" on public.learning_memory;

-- Bu satırlar yorum satırı olarak bırakılmıştır; körlemesine çalıştırmayın.
