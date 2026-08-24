-- ANNVERO 035 — E-Defter control persist atomik RPC
-- Forward-only. Tablo silme / truncate / toplu delete yok.
-- Ham XML/ZIP/VKN/IBAN saklanmaz; API zaten sanitize eder.
-- EXECUTE yalnız service_role. search_path sabit (public yok).

-- ---------------------------------------------------------------------------
-- Idempotency: failed orphan'lar unique slot'u bloke etmesin
-- ---------------------------------------------------------------------------
drop index if exists public.uq_edefter_control_runs_idempotent;

create unique index if not exists uq_edefter_control_runs_idempotent
  on public.edefter_control_runs (company_id, source_fingerprint, engine_version)
  where deleted_at is null
    and source_fingerprint <> ''
    and status not in ('deleted', 'failed');

comment on index public.uq_edefter_control_runs_idempotent is
  'Aktif tamamlanmış/çalışan run tekilliği. failed orphan retry engellemez.';

-- ---------------------------------------------------------------------------
-- Atomik persist RPC
-- ---------------------------------------------------------------------------
create or replace function public.edefter_persist_control_run_atomic(
  p_run jsonb,
  p_findings jsonb default '[]'::jsonb,
  p_actor_id text default '',
  p_retry boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_company_id text;
  v_period text;
  v_status text;
  v_engine text;
  v_source_fp text;
  v_journal_fp text;
  v_ledger_fp text;
  v_doc_types jsonb;
  v_doc_count integer;
  v_row_count integer;
  v_opening jsonb;
  v_closing jsonb;
  v_recon_status text;
  v_recon_summary jsonb;
  v_severity jsonb;
  v_result_summary jsonb;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_actor text;
  v_existing public.edefter_control_runs%rowtype;
  v_previous public.edefter_control_runs%rowtype;
  v_revision integer;
  v_run_id uuid;
  v_finding_count integer := 0;
  v_created boolean := false;
  v_reused boolean := false;
  v_findings_in integer;
begin
  if p_run is null or jsonb_typeof(p_run) <> 'object' then
    raise exception 'edefter_persist_control_run_atomic: p_run object zorunlu'
      using errcode = '22023';
  end if;

  v_company_id := nullif(btrim(coalesce(p_run->>'company_id', '')), '');
  v_engine := nullif(btrim(coalesce(p_run->>'engine_version', '')), '');
  v_source_fp := nullif(btrim(coalesce(p_run->>'source_fingerprint', '')), '');
  if v_company_id is null or char_length(v_company_id) > 120 then
    raise exception 'edefter_persist_control_run_atomic: company_id geçersiz'
      using errcode = '22023';
  end if;
  if v_engine is null or char_length(v_engine) > 40 then
    raise exception 'edefter_persist_control_run_atomic: engine_version geçersiz'
      using errcode = '22023';
  end if;
  if v_source_fp is null or char_length(v_source_fp) > 128 then
    raise exception 'edefter_persist_control_run_atomic: source_fingerprint geçersiz'
      using errcode = '22023';
  end if;

  v_period := left(coalesce(p_run->>'period', ''), 32);
  v_status := coalesce(nullif(btrim(coalesce(p_run->>'status', '')), ''), 'completed');
  if v_status <> 'completed' then
    -- Atomic path yalnız completed yazar; kısmi/failed client status kabul edilmez
    v_status := 'completed';
  end if;

  v_journal_fp := left(coalesce(p_run->>'journal_fingerprint', ''), 128);
  v_ledger_fp := left(coalesce(p_run->>'ledger_fingerprint', ''), 128);
  v_doc_types := coalesce(p_run->'document_types', '[]'::jsonb);
  if jsonb_typeof(v_doc_types) <> 'array' then
    v_doc_types := '[]'::jsonb;
  end if;
  v_doc_count := greatest(coalesce((p_run->>'document_count')::integer, 0), 0);
  v_row_count := greatest(coalesce((p_run->>'row_count')::integer, 0), 0);
  v_opening := coalesce(p_run->'opening_balance_summary', '{}'::jsonb);
  v_closing := coalesce(p_run->'closing_balance_summary', '{}'::jsonb);
  v_recon_status := coalesce(nullif(btrim(coalesce(p_run->>'reconciliation_status', '')), ''), 'skipped');
  if v_recon_status not in ('matched', 'mismatched', 'skipped', 'partial') then
    v_recon_status := 'skipped';
  end if;
  v_recon_summary := coalesce(p_run->'reconciliation_summary', '{}'::jsonb);
  v_severity := coalesce(p_run->'severity_counts', '{}'::jsonb);
  v_result_summary := coalesce(p_run->'result_summary', '{}'::jsonb);
  v_started_at := nullif(p_run->>'started_at', '')::timestamptz;
  v_completed_at := coalesce(nullif(p_run->>'completed_at', '')::timestamptz, clock_timestamp());
  v_actor := left(coalesce(p_actor_id, ''), 160);

  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then
    raise exception 'edefter_persist_control_run_atomic: p_findings array zorunlu'
      using errcode = '22023';
  end if;
  v_findings_in := jsonb_array_length(p_findings);
  if v_findings_in > 500 then
    raise exception 'edefter_persist_control_run_atomic: findings üst sınırı 500'
      using errcode = '22023';
  end if;

  -- Tamamlanmış idempotent hit
  select * into v_existing
  from public.edefter_control_runs r
  where r.company_id = v_company_id
    and r.source_fingerprint = v_source_fp
    and r.engine_version = v_engine
    and r.deleted_at is null
    and r.status = 'completed'
  order by r.created_at desc
  limit 1;

  if found then
    select count(*)::integer into v_finding_count
    from public.edefter_control_findings f
    where f.run_id = v_existing.id
      and f.company_id = v_company_id
      and f.deleted_at is null;

    insert into public.edefter_control_audit_events (
      run_id, company_id, event_type, actor_id, safe_metadata
    ) values (
      v_existing.id,
      v_company_id,
      case when coalesce(p_retry, false) then 'save_retry' else 'run_idempotent_hit' end,
      v_actor,
      jsonb_build_object(
        'engine_version', v_engine,
        'period', v_period,
        'idempotent', true,
        'retry', coalesce(p_retry, false),
        'finding_count', v_finding_count
      )
    );

    return jsonb_build_object(
      'ok', true,
      'created', false,
      'reused', true,
      'idempotent', true,
      'run_id', v_existing.id,
      'revision', v_existing.revision,
      'finding_count', v_finding_count,
      'status', v_existing.status
    );
  end if;

  -- Eski failed orphan'ları soft-delete (unique slot temizliği; bulk DELETE yok)
  update public.edefter_control_runs r
  set
    status = 'deleted',
    deleted_at = clock_timestamp(),
    deleted_by = 'atomic_persist_reclaim',
    updated_at = clock_timestamp()
  where r.company_id = v_company_id
    and r.source_fingerprint = v_source_fp
    and r.engine_version = v_engine
    and r.deleted_at is null
    and r.status = 'failed';

  -- Önceki revision (aynı fingerprint, farklı engine veya superseded adayı)
  select * into v_previous
  from public.edefter_control_runs r
  where r.company_id = v_company_id
    and r.source_fingerprint = v_source_fp
    and r.deleted_at is null
    and r.status not in ('deleted', 'failed')
  order by r.revision desc
  limit 1;

  v_revision := case when found then coalesce(v_previous.revision, 1) + 1 else 1 end;

  insert into public.edefter_control_runs (
    company_id,
    period,
    status,
    engine_version,
    source_fingerprint,
    journal_fingerprint,
    ledger_fingerprint,
    document_types,
    document_count,
    row_count,
    opening_balance_summary,
    closing_balance_summary,
    reconciliation_status,
    reconciliation_summary,
    severity_counts,
    result_summary,
    revision,
    supersedes_run_id,
    started_at,
    completed_at,
    created_by
  ) values (
    v_company_id,
    v_period,
    v_status,
    v_engine,
    v_source_fp,
    v_journal_fp,
    v_ledger_fp,
    v_doc_types,
    v_doc_count,
    v_row_count,
    v_opening,
    v_closing,
    v_recon_status,
    v_recon_summary,
    v_severity,
    v_result_summary,
    v_revision,
    case when v_previous.id is not null then v_previous.id else null end,
    v_started_at,
    v_completed_at,
    v_actor
  )
  returning id into v_run_id;

  v_created := true;

  if v_findings_in > 0 then
    insert into public.edefter_control_findings (
      run_id,
      company_id,
      code,
      severity,
      category,
      safe_reference,
      summary,
      occurrence_count,
      resolution_status
    )
    select
      v_run_id,
      v_company_id,
      left(coalesce(f.code, ''), 80),
      left(coalesce(nullif(f.severity, ''), 'info'), 32),
      left(coalesce(f.category, ''), 80),
      left(coalesce(f.safe_reference, ''), 160),
      left(coalesce(f.summary, ''), 280),
      greatest(coalesce(f.occurrence_count, 1), 1),
      left(coalesce(nullif(f.resolution_status, ''), 'open'), 32)
    from jsonb_to_recordset(p_findings) as f(
      code text,
      severity text,
      category text,
      safe_reference text,
      summary text,
      occurrence_count integer,
      resolution_status text
    );

    get diagnostics v_finding_count = row_count;
    if v_finding_count <> v_findings_in then
      raise exception 'edefter_persist_control_run_atomic: findings satır sayısı uyuşmuyor'
        using errcode = 'P0001';
    end if;
  end if;

  if v_previous.id is not null and v_previous.id is distinct from v_run_id then
    update public.edefter_control_runs
    set status = 'superseded', updated_at = clock_timestamp()
    where id = v_previous.id
      and company_id = v_company_id
      and deleted_at is null;

    insert into public.edefter_control_audit_events (
      run_id, company_id, event_type, actor_id, safe_metadata
    ) values (
      v_run_id,
      v_company_id,
      'run_superseded',
      v_actor,
      jsonb_build_object(
        'engine_version', v_engine,
        'superseded_run_id', v_previous.id,
        'revision', v_revision
      )
    );
  end if;

  insert into public.edefter_control_audit_events (
    run_id, company_id, event_type, actor_id, safe_metadata
  ) values (
    v_run_id,
    v_company_id,
    'run_created',
    v_actor,
    jsonb_build_object(
      'engine_version', v_engine,
      'period', v_period,
      'revision', v_revision,
      'document_count', v_doc_count,
      'row_count', v_row_count,
      'reconciliation_status', v_recon_status,
      'severity_counts', v_severity,
      'overall_sonuc', v_result_summary->>'overall_sonuc',
      'retry', coalesce(p_retry, false),
      'identity_status', v_result_summary->>'identity_status',
      'identity_verified', coalesce((v_result_summary->>'identity_verified')::boolean, false),
      'identity_user_confirmed', coalesce((v_result_summary->>'identity_user_confirmed')::boolean, false),
      'identity_confirmation', coalesce(v_result_summary->>'identity_confirmation', ''),
      'identity_fingerprint', coalesce(v_result_summary->>'identity_fingerprint', ''),
      'finding_count', v_finding_count,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'reused', v_reused,
    'idempotent', false,
    'run_id', v_run_id,
    'revision', v_revision,
    'finding_count', v_finding_count,
    'status', v_status
  );
exception
  when unique_violation then
    -- Yarış: tamamlanmış kaydı yeniden oku
    select * into v_existing
    from public.edefter_control_runs r
    where r.company_id = v_company_id
      and r.source_fingerprint = v_source_fp
      and r.engine_version = v_engine
      and r.deleted_at is null
      and r.status = 'completed'
    order by r.created_at desc
    limit 1;
    if not found then
      raise;
    end if;
    select count(*)::integer into v_finding_count
    from public.edefter_control_findings f
    where f.run_id = v_existing.id
      and f.deleted_at is null;
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'reused', true,
      'idempotent', true,
      'run_id', v_existing.id,
      'revision', v_existing.revision,
      'finding_count', v_finding_count,
      'status', v_existing.status,
      'race', true
    );
end;
$$;

revoke all on function public.edefter_persist_control_run_atomic(jsonb, jsonb, text, boolean)
  from public;
revoke all on function public.edefter_persist_control_run_atomic(jsonb, jsonb, text, boolean)
  from anon, authenticated;
grant execute on function public.edefter_persist_control_run_atomic(jsonb, jsonb, text, boolean)
  to service_role;

comment on function public.edefter_persist_control_run_atomic(jsonb, jsonb, text, boolean) is
  'E-Defter run+findings+audit tek transaction. SECURITY DEFINER; EXECUTE yalnız service_role. Kısmi yazım yok.';
