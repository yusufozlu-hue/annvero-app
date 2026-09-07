-- Faz 7 / 037 — Accounting memory governance (additive, idempotent, duplicate-safe)
-- DO NOT apply in this delivery unless explicitly approved.
-- No table DROP / hard delete of business rows. No TRUNCATE of business tables.
-- RPC: SECURITY DEFINER, search_path=pg_catalog,pg_temp, EXECUTE yalnız service_role.
-- Authenticated: SELECT-only (tenant scoped). Mutations yalnız server RPC.

-- ---------------------------------------------------------------------------
-- 1) Additive columns
-- ---------------------------------------------------------------------------
alter table public.learning_memory
  add column if not exists revision integer not null default 1;

alter table public.learning_memory
  add column if not exists supersedes_id uuid null;

alter table public.learning_memory
  add column if not exists parent_revision_id uuid null;

alter table public.learning_memory
  add column if not exists reason_code text null;

alter table public.learning_memory
  add column if not exists luca_leg text null;

alter table public.learning_memory
  add column if not exists governance_ready boolean not null default false;

comment on column public.learning_memory.revision is
  'Governance revision (CAS). Critical field changes bump revision.';
comment on column public.learning_memory.supersedes_id is
  'Prior row this revision supersedes.';
comment on column public.learning_memory.parent_revision_id is
  'Parent memory id for rollback/reactivate lineage.';
comment on column public.learning_memory.reason_code is
  'Machine reason code (no PII).';
comment on column public.learning_memory.luca_leg is
  'statement | counter | empty for keyword memory.';
comment on column public.learning_memory.governance_ready is
  'Set true after 037 preflight normalization (idempotency marker).';

-- ---------------------------------------------------------------------------
-- 2) Preflight helper: infer luca_leg from account_code (safe)
-- ---------------------------------------------------------------------------
create or replace function public.annvero_infer_luca_leg(p_account_code text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when nullif(btrim(coalesce(p_account_code, '')), '') is null then null
    when btrim(p_account_code) ~ '^102([.]|$)' then 'statement'
    when btrim(p_account_code) ~ '^(1|2|3|4|5|6|7|8|9)' then 'counter'
    else null
  end;
$$;

revoke all on function public.annvero_infer_luca_leg(text) from public;
grant execute on function public.annvero_infer_luca_leg(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Duplicate-safe preflight (idempotent) — no hard delete
-- ---------------------------------------------------------------------------
do $$
declare
  v_already boolean;
begin
  select exists (
    select 1
    from public.learning_memory
    where governance_ready = true
    limit 1
  ) into v_already;

  -- Fill empty luca_leg once (only rows not yet marked ready)
  update public.learning_memory lm
  set luca_leg = public.annvero_infer_luca_leg(lm.account_code)
  where coalesce(lm.governance_ready, false) = false
    and (lm.luca_leg is null or btrim(lm.luca_leg) = '')
    and lm.document_type = 'BANK_STATEMENT_ACCOUNTING'
    and public.annvero_infer_luca_leg(lm.account_code) is not null;

  -- BSA with still-unknown leg → review (not auto-active)
  update public.learning_memory lm
  set
    status = 'review',
    is_active = false,
    reason_code = 'migration_037_ambiguous_leg',
    governance_ready = true
  where coalesce(lm.governance_ready, false) = false
    and lm.document_type = 'BANK_STATEMENT_ACCOUNTING'
    and lm.deleted_at is null
    and coalesce(lm.status, 'active') = 'active'
    and coalesce(lm.is_active, true) = true
    and (lm.luca_leg is null or btrim(lm.luca_leg) = '');

  -- Identical account duplicates in same active group → keep newest active, others superseded
  with ranked as (
    select
      id,
      company_id,
      keyword,
      coalesce(luca_leg, '') as leg,
      account_code,
      row_number() over (
        partition by company_id, keyword, coalesce(luca_leg, ''), account_code
        order by coalesce(updated_at, learned_at, created_at) desc nulls last, id desc
      ) as rn
    from public.learning_memory
    where coalesce(governance_ready, false) = false
      and deleted_at is null
      and coalesce(status, 'active') = 'active'
      and coalesce(is_active, true) = true
  )
  update public.learning_memory lm
  set
    status = 'superseded',
    is_active = false,
    reason_code = 'migration_037_duplicate_same_account',
    governance_ready = true
  from ranked r
  where lm.id = r.id
    and r.rn > 1;

  -- Remaining multi-account active groups → all review/conflict (no silent winner)
  with conflict_groups as (
    select
      company_id,
      keyword,
      coalesce(luca_leg, '') as leg
    from public.learning_memory
    where deleted_at is null
      and coalesce(status, 'active') = 'active'
      and coalesce(is_active, true) = true
      and coalesce(governance_ready, false) = false
    group by company_id, keyword, coalesce(luca_leg, '')
    having count(distinct account_code) > 1
  )
  update public.learning_memory lm
  set
    status = 'review',
    is_active = false,
    reason_code = 'migration_037_preflight_conflict',
    governance_ready = true
  from conflict_groups g
  where lm.company_id = g.company_id
    and lm.keyword = g.keyword
    and coalesce(lm.luca_leg, '') = g.leg
    and lm.deleted_at is null
    and coalesce(lm.status, 'active') = 'active'
    and coalesce(lm.is_active, true) = true
    and coalesce(lm.governance_ready, false) = false;

  -- Mark remaining untouched rows ready (second run no-op)
  update public.learning_memory
  set governance_ready = true
  where coalesce(governance_ready, false) = false;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Unique active index AFTER RPC goes live
--    Canonical: company_id + signature(keyword) + luca_leg + active-only
-- ---------------------------------------------------------------------------
drop index if exists public.uq_learning_memory_active_bsa_keyword;

create unique index if not exists uq_learning_memory_active_signature_leg
  on public.learning_memory (
    company_id,
    keyword,
    (coalesce(luca_leg, ''))
  )
  where status = 'active'
    and deleted_at is null
    and coalesce(is_active, true) = true;

comment on index public.uq_learning_memory_active_signature_leg is
  'At most one active memory per company+signature+lucaLeg. Preflight clears conflicts first.';

create index if not exists idx_learning_memory_company_luca_leg
  on public.learning_memory (company_id, luca_leg)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 5) RLS: authenticated SELECT only; no direct client write/delete
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.learning_memory') is null then
    raise exception '037: learning_memory missing';
  end if;

  execute 'alter table public.learning_memory enable row level security';

  execute 'drop policy if exists "learning_memory_insert_authenticated" on public.learning_memory';
  execute 'drop policy if exists "learning_memory_update_authenticated" on public.learning_memory';
  execute 'drop policy if exists "learning_memory_delete_authenticated" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory delete" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory insert" on public.learning_memory';
  execute 'drop policy if exists "allow learning memory update" on public.learning_memory';

  -- Keep / recreate select policy (tenant + soft-delete)
  execute 'drop policy if exists "learning_memory_select_authenticated" on public.learning_memory';
  execute $sql$
    create policy "learning_memory_select_authenticated"
      on public.learning_memory
      for select
      to authenticated
      using (
        public.annvero_can_access_company(company_id)
        and deleted_at is null
      )
  $sql$;
end $$;

revoke all on table public.learning_memory from anon;
-- authenticated: SELECT via RLS policy only (no INSERT/UPDATE/DELETE grants required)
revoke insert, update, delete on table public.learning_memory from authenticated;
grant select on table public.learning_memory to authenticated;
grant all on table public.learning_memory to service_role;

-- ---------------------------------------------------------------------------
-- 6) Atomic governance RPC (mutation + audit same transaction)
-- ---------------------------------------------------------------------------
create or replace function public.learning_memory_governance_mutate(
  p_action text,
  p_company_id text,
  p_memory_id uuid,
  p_expected_revision integer,
  p_actor_id text default '',
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_company text := nullif(btrim(coalesce(p_company_id, '')), '');
  v_actor text := nullif(btrim(coalesce(p_actor_id, '')), '');
  v_row public.learning_memory%rowtype;
  v_current_rev integer;
  v_new_id uuid;
  v_new_rev integer;
  v_before jsonb;
  v_after jsonb;
  v_reason text;
  v_account text;
  v_leg text;
  v_sib record;
  v_force_audit_fail boolean;
begin
  if v_company is null or char_length(v_company) > 120 then
    raise exception 'learning_memory_governance_mutate: company_id invalid'
      using errcode = '22023';
  end if;
  if p_memory_id is null then
    raise exception 'learning_memory_governance_mutate: memory_id required'
      using errcode = '22023';
  end if;
  if v_action not in ('deactivate', 'reactivate', 'rollback', 'resolve_conflict', 'revise') then
    raise exception 'learning_memory_governance_mutate: unknown action'
      using errcode = '22023';
  end if;

  v_force_audit_fail := coalesce((p_payload->>'__force_audit_fail')::boolean, false);

  select * into v_row
  from public.learning_memory
  where id = p_memory_id
  for update;

  -- Tenant miss → NOT_FOUND (no existence leak)
  if not found or v_row.company_id is distinct from v_company or v_row.deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  v_current_rev := greatest(1, coalesce(v_row.revision, 1));
  if p_expected_revision is not null and v_current_rev <> p_expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'REVISION_CONFLICT',
      'requiresReview', true,
      'currentRevision', v_current_rev,
      'expectedRevision', p_expected_revision
    );
  end if;

  v_reason := nullif(btrim(coalesce(p_payload->>'reason_code', '')), '');
  v_account := nullif(btrim(coalesce(p_payload->>'account_code', v_row.account_code)), '');
  v_leg := coalesce(nullif(btrim(coalesce(v_row.luca_leg, '')), ''), '');

  v_before := jsonb_build_object(
    'memoryId', v_row.id,
    'accountCode', v_row.account_code,
    'status', v_row.status,
    'revision', v_current_rev,
    'lucaLeg', v_row.luca_leg
  );

  if v_action = 'deactivate' then
    v_new_rev := v_current_rev + 1;
    update public.learning_memory
    set
      status = 'passive',
      is_active = false,
      revision = v_new_rev,
      parent_revision_id = v_row.id,
      reason_code = coalesce(v_reason, 'user_deactivate'),
      updated_at = now()
    where id = v_row.id;
    v_new_id := v_row.id;

  elsif v_action = 'reactivate' then
    -- Supersede other actives same signature+leg first (unique-safe order)
    for v_sib in
      select id, revision
      from public.learning_memory
      where company_id = v_company
        and keyword = v_row.keyword
        and coalesce(luca_leg, '') = v_leg
        and id <> v_row.id
        and deleted_at is null
        and status = 'active'
        and coalesce(is_active, true) = true
      for update
    loop
      update public.learning_memory
      set
        status = 'superseded',
        is_active = false,
        reason_code = 'superseded_by_learn',
        updated_at = now()
      where id = v_sib.id;
    end loop;

    v_new_rev := v_current_rev + 1;
    update public.learning_memory
    set
      status = 'active',
      is_active = true,
      deleted_at = null,
      revision = v_new_rev,
      parent_revision_id = v_row.id,
      reason_code = coalesce(v_reason, 'user_reactivate'),
      updated_at = now()
    where id = v_row.id;
    v_new_id := v_row.id;

  elsif v_action = 'resolve_conflict' then
    for v_sib in
      select id
      from public.learning_memory
      where company_id = v_company
        and keyword = v_row.keyword
        and coalesce(luca_leg, '') = v_leg
        and id <> v_row.id
        and deleted_at is null
        and status in ('active', 'review')
      for update
    loop
      update public.learning_memory
      set
        status = 'superseded',
        is_active = false,
        reason_code = 'conflict_resolve',
        updated_at = now()
      where id = v_sib.id;
    end loop;

    v_new_rev := v_current_rev + 1;
    update public.learning_memory
    set
      status = 'active',
      is_active = true,
      revision = v_new_rev,
      parent_revision_id = v_row.id,
      reason_code = 'conflict_resolve',
      updated_at = now()
    where id = v_row.id;
    v_new_id := v_row.id;

  elsif v_action = 'revise' then
    -- Mark current superseded, insert new active (unique-safe order)
    update public.learning_memory
    set
      status = 'superseded',
      is_active = false,
      reason_code = 'superseded_by_learn',
      updated_at = now()
    where id = v_row.id;

    v_new_rev := v_current_rev + 1;
    insert into public.learning_memory (
      company_id, keyword, clean_description, raw_description,
      account_code, account_name, counter_account_code, document_type,
      transaction_type, source_module, bank_name, status, is_active,
      revision, supersedes_id, parent_revision_id, reason_code, luca_leg,
      user_correction, learned_at, governance_ready
    ) values (
      v_row.company_id, v_row.keyword, v_row.keyword, v_row.keyword,
      coalesce(v_account, v_row.account_code), v_row.account_name, v_row.counter_account_code,
      v_row.document_type, v_row.transaction_type, v_row.source_module, v_row.bank_name,
      'active', true,
      v_new_rev, v_row.id, v_row.id, coalesce(v_reason, 'user_edit'), v_row.luca_leg,
      v_row.user_correction, now(), true
    )
    returning id into v_new_id;

  elsif v_action = 'rollback' then
    -- Supersede current actives for signature+leg, insert clone from target (target unchanged)
    for v_sib in
      select id
      from public.learning_memory
      where company_id = v_company
        and keyword = v_row.keyword
        and coalesce(luca_leg, '') = v_leg
        and deleted_at is null
        and status = 'active'
        and coalesce(is_active, true) = true
      for update
    loop
      update public.learning_memory
      set
        status = 'superseded',
        is_active = false,
        reason_code = 'rollback',
        updated_at = now()
      where id = v_sib.id;
    end loop;

    v_new_rev := v_current_rev + 1;
    insert into public.learning_memory (
      company_id, keyword, clean_description, raw_description,
      account_code, account_name, counter_account_code, document_type,
      transaction_type, source_module, bank_name, status, is_active,
      revision, supersedes_id, parent_revision_id, reason_code, luca_leg,
      user_correction, learned_at, governance_ready
    ) values (
      v_row.company_id, v_row.keyword, v_row.keyword, v_row.keyword,
      v_row.account_code, v_row.account_name, v_row.counter_account_code,
      v_row.document_type, v_row.transaction_type, 'GOVERNANCE_ROLLBACK', v_row.bank_name,
      'active', true,
      v_new_rev, v_row.id, v_row.id, 'rollback', v_row.luca_leg,
      v_row.user_correction, now(), true
    )
    returning id into v_new_id;
  end if;

  select jsonb_build_object(
    'memoryId', id,
    'accountCode', account_code,
    'status', status,
    'revision', revision,
    'lucaLeg', luca_leg
  )
  into v_after
  from public.learning_memory
  where id = v_new_id;

  if v_force_audit_fail then
    raise exception 'learning_memory_governance_mutate: forced audit failure'
      using errcode = 'P0001';
  end if;

  insert into public.audit_events (
    actor_id, company_id, entity_type, entity_id, action,
    before_state, after_state, metadata, created_at
  ) values (
    coalesce(v_actor, ''),
    v_company,
    'learning_memory',
    v_new_id::text,
    v_action,
    v_before,
    v_after,
    jsonb_build_object(
      'fromRevision', v_current_rev,
      'toRevision', v_new_rev,
      'reasonCode', coalesce(v_reason, v_action),
      'sourceMemoryId', v_row.id
    ),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'memoryId', v_new_id,
    'revision', v_new_rev,
    'action', v_action,
    'record', v_after,
    'sourceUnchanged', case when v_action = 'rollback' then true else null end
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'code', 'REVISION_CONFLICT',
      'requiresReview', true,
      'message', 'active_unique_violation'
    );
end;
$$;

revoke all on function public.learning_memory_governance_mutate(text, text, uuid, integer, text, jsonb)
  from public;
revoke all on function public.learning_memory_governance_mutate(text, text, uuid, integer, text, jsonb)
  from anon, authenticated;
grant execute on function public.learning_memory_governance_mutate(text, text, uuid, integer, text, jsonb)
  to service_role;

comment on function public.learning_memory_governance_mutate(text, text, uuid, integer, text, jsonb) is
  'Atomic governance mutation+audit. SECURITY DEFINER search_path fixed. EXECUTE service_role only. CAS via expectedRevision.';

-- ---------------------------------------------------------------------------
-- 7) Preflight query helper (dry-run / tests) — read-only
-- ---------------------------------------------------------------------------
create or replace function public.learning_memory_governance_preflight(p_company_id text default null)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'activeConflicts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'companyId', company_id,
        'keyword', keyword,
        'lucaLeg', coalesce(luca_leg, ''),
        'accountCodes', account_codes,
        'cnt', cnt
      ))
      from (
        select company_id, keyword, coalesce(luca_leg, '') as luca_leg,
               array_agg(distinct account_code) as account_codes,
               count(*)::int as cnt
        from public.learning_memory
        where deleted_at is null
          and status = 'active'
          and coalesce(is_active, true) = true
          and (p_company_id is null or company_id = p_company_id)
        group by company_id, keyword, coalesce(luca_leg, '')
        having count(distinct account_code) > 1
      ) s
    ), '[]'::jsonb),
    'ambiguousLegs', coalesce((
      select count(*)::int
      from public.learning_memory
      where deleted_at is null
        and document_type = 'BANK_STATEMENT_ACCOUNTING'
        and status = 'review'
        and reason_code = 'migration_037_ambiguous_leg'
        and (p_company_id is null or company_id = p_company_id)
    ), 0),
    'governanceReady', coalesce((
      select bool_and(governance_ready)
      from public.learning_memory
      where (p_company_id is null or company_id = p_company_id)
    ), true)
  );
$$;

revoke all on function public.learning_memory_governance_preflight(text) from public;
revoke all on function public.learning_memory_governance_preflight(text) from anon, authenticated;
grant execute on function public.learning_memory_governance_preflight(text) to service_role;
