-- ANNVERO Knowledge Engine — Görev 5
-- Gerçek global muhasebe kural seed revizyonu (idempotent)
-- Önkoşul: 017_knowledge_engine.sql (entity + tablo omurgası)

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
  if to_regclass('public.knowledge_accounting_rules') is null then
    raise notice '018 skip: knowledge_accounting_rules yok — önce 017 çalıştırın';
    return;
  end if;

  insert into public.knowledge_accounting_rules (
    id, entity_id, company_id, source_type, transaction_direction,
    debit_account_code, debit_account_name, credit_account_code, credit_account_name,
    vat_rate, document_type, cari_name, description_template,
    rule_source, priority, confidence, risk_level, is_global, is_active
  ) values
    -- A) Google — bank
    (
      'c3000002-0001-4000-8000-000000000001', v_google, null, 'bank', 'debit',
      '770', 'Reklam / pazarlama giderleri', '320', 'Google cari',
      null, 'FT', 'Google', 'Google reklam / dijital hizmet gideri',
      'global', 10, 0.85, 'medium', true, true
    ),
    -- A) Google — credit_card
    (
      'c3000001-0001-4000-8000-000000000001', v_google, null, 'credit_card', 'debit',
      '770', 'Reklam / pazarlama giderleri', '320', 'Google cari',
      null, 'FT', 'Google', 'Google reklam / dijital hizmet gideri',
      'global', 10, 0.85, 'medium', true, true
    ),
    -- B) Meta — bank
    (
      'c3000002-0001-4000-8000-000000000002', v_meta, null, 'bank', 'debit',
      '770', 'Reklam / pazarlama giderleri', '320', 'Satıcılar',
      null, 'FT', 'Meta / Facebook', 'Meta/Facebook reklam gideri',
      'global', 10, 0.85, 'medium', true, true
    ),
    -- B) Meta — credit_card
    (
      'c3000001-0001-4000-8000-000000000002', v_meta, null, 'credit_card', 'debit',
      '770', 'Reklam / pazarlama giderleri', '320', 'Satıcılar',
      null, 'FT', 'Meta / Facebook', 'Meta/Facebook reklam gideri',
      'global', 10, 0.85, 'medium', true, true
    ),
    -- C) SGK — bank
    (
      'c3000001-0001-4000-8000-000000000003', v_sgk, null, 'bank', 'debit',
      '361', 'Ödenecek SGK primleri', '102', 'Bankalar',
      null, 'DK', 'SGK', 'SGK prim ödemesi',
      'global', 10, 0.90, 'low', true, true
    ),
    -- D) GİB — bank
    (
      'c3000002-0001-4000-8000-000000000003', v_gib, null, 'bank', 'debit',
      '360', 'Ödenecek vergi ve fonlar', '102', 'Bankalar',
      null, 'DK', 'GİB', 'KDV / vergi ödemesi',
      'global', 10, 0.80, 'medium', true, true
    ),
    -- E) Turkcell — bank
    (
      'c3000002-0001-4000-8000-000000000004', v_turkcell, null, 'bank', 'debit',
      '770', 'Genel yönetim giderleri', '320', 'Satıcılar',
      null, 'FT', 'Turkcell', 'Turkcell iletişim gideri',
      'global', 10, 0.80, 'low', true, true
    ),
    -- E) Turkcell — credit_card
    (
      'c3000002-0001-4000-8000-000000000005', v_turkcell, null, 'credit_card', 'debit',
      '770', 'Genel yönetim giderleri', '320', 'Satıcılar',
      null, 'FT', 'Turkcell', 'Turkcell iletişim gideri',
      'global', 10, 0.80, 'low', true, true
    ),
    -- F) Türk Telekom — bank
    (
      'c3000002-0001-4000-8000-000000000006', v_turktelekom, null, 'bank', 'debit',
      '770', 'Genel yönetim giderleri', '320', 'Satıcılar',
      null, 'FT', 'Türk Telekom', 'Türk Telekom iletişim gideri',
      'global', 10, 0.80, 'low', true, true
    ),
    -- F) Türk Telekom — credit_card
    (
      'c3000002-0001-4000-8000-000000000007', v_turktelekom, null, 'credit_card', 'debit',
      '770', 'Genel yönetim giderleri', '320', 'Satıcılar',
      null, 'FT', 'Türk Telekom', 'Türk Telekom iletişim gideri',
      'global', 10, 0.80, 'low', true, true
    ),
    -- G) Booking.com — bank
    (
      'c3000001-0001-4000-8000-000000000004', v_booking, null, 'bank', 'debit',
      '120', 'Alıcılar', '600', 'Yurt İçi Satışlar',
      null, 'FT', 'Booking.com', 'Booking tahsilatı / komisyon kontrolü gerekli',
      'global', 10, 0.75, 'medium', true, true
    ),
    -- H) Expedia — bank
    (
      'c3000002-0001-4000-8000-000000000008', v_expedia, null, 'bank', 'debit',
      '120', 'Alıcılar', '600', 'Yurt İçi Satışlar',
      null, 'FT', 'Expedia', 'Expedia tahsilatı / komisyon kontrolü gerekli',
      'global', 10, 0.75, 'medium', true, true
    )
  on conflict (id) do update set
    entity_id = excluded.entity_id,
    company_id = excluded.company_id,
    source_type = excluded.source_type,
    transaction_direction = excluded.transaction_direction,
    debit_account_code = excluded.debit_account_code,
    debit_account_name = excluded.debit_account_name,
    credit_account_code = excluded.credit_account_code,
    credit_account_name = excluded.credit_account_name,
    vat_rate = excluded.vat_rate,
    document_type = excluded.document_type,
    cari_name = excluded.cari_name,
    description_template = excluded.description_template,
    rule_source = excluded.rule_source,
    priority = excluded.priority,
    confidence = excluded.confidence,
    risk_level = excluded.risk_level,
    is_global = excluded.is_global,
    is_active = excluded.is_active,
    updated_at = now(),
    deleted_at = null;

  raise notice '018 seed: 12 global accounting rule upserted (Görev 5)';
end;
$$;

comment on table public.knowledge_accounting_rules is
  'Muhasebe Bilgi Motoru — entity/pattern için muhasebe öneri kuralları (018 gerçek global seed).';
