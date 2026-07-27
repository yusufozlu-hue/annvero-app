-- ANNVERO: Firma-bound Google Drive office credential binding
-- Mükellef / oturum kullanıcısının kişisel OAuth’u kullanılmaz.
-- company_cloud_folders.connection_id → cloud_storage_connections (ofis/management).

comment on column public.company_cloud_folders.connection_id is
  'Firma depolama için ofis/management Google Drive bağlantısı (cloud_storage_connections.id). Mükellef oturumu değil; upload/sync/reconcile bu bağ üzerinden çözülür.';

create index if not exists idx_company_cloud_folders_connection
  on public.company_cloud_folders (connection_id)
  where connection_id is not null;
