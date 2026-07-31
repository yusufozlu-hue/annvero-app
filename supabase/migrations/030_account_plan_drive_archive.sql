-- ANNVERO 030 — Hesap planı Drive arşiv metadata (forward-only, idempotent)
-- Migration 029 zaten uygulandı; aktif sürüm / satırlar silinmez.
-- Drive teknik kimlik (file id / token) istemciye dönülmez; yalnız durum alanları.

alter table public.company_account_plan_uploads
  add column if not exists original_file_name text not null default '';

alter table public.company_account_plan_uploads
  add column if not exists file_content_hash text not null default '';

alter table public.company_account_plan_uploads
  add column if not exists archive_status text not null default 'none';

alter table public.company_account_plan_uploads
  add column if not exists archived_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_account_plan_uploads_archive_status_check'
  ) then
    alter table public.company_account_plan_uploads
      add constraint company_account_plan_uploads_archive_status_check
      check (archive_status in (
        'none',
        'archived',
        'archive_pending',
        'archive_skipped',
        'duplicate_archived'
      ));
  end if;
end $$;

comment on column public.company_account_plan_uploads.original_file_name is
  'Kullanıcının yüklediği orijinal Excel adı (Drive görünür adından ayrı).';
comment on column public.company_account_plan_uploads.file_content_hash is
  'Dosya içerik SHA-256; aynı hash ikinci Drive kopyası oluşturmaz.';
comment on column public.company_account_plan_uploads.archive_status is
  'Drive arşiv durumu. archive_pending aktif planı bozmaz.';

create index if not exists idx_account_plan_uploads_file_hash
  on public.company_account_plan_uploads (company_id, file_content_hash)
  where deleted_at is null and file_content_hash <> '';
