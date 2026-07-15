-- ANNVERO Mali Yükümlülük Merkezi V1 — MIGRATION DRAFT ONLY
-- DO NOT RUN in this package. Schema reference for future migrate.

-- obligation_accruals
CREATE TABLE IF NOT EXISTS obligation_accruals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  obligation_type TEXT NOT NULL,
  document_type TEXT NOT NULL,
  tax_period_start TEXT,
  tax_period_end TEXT,
  period_key TEXT NOT NULL,
  revision_type TEXT NOT NULL DEFAULT 'NORMAL',
  revision_no INTEGER NOT NULL DEFAULT 0,
  declaration_date TEXT,
  accrual_date TEXT,
  due_date TEXT,
  accrual_number TEXT,
  document_reference TEXT,
  total_principal NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_stamp_tax NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_penalty NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_late_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_late_interest NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_incentive_on_document NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_payable NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TRY',
  source_file_id TEXT,
  source_file_name TEXT,
  source_file_hash TEXT,
  source_provider TEXT NOT NULL DEFAULT 'upload',
  status TEXT NOT NULL DEFAULT 'OPEN',
  parser_version TEXT,
  confidence NUMERIC(6,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_obligation_chain
  ON obligation_accruals (company_id, obligation_type, period_key, revision_no, document_type);

CREATE UNIQUE INDEX IF NOT EXISTS ux_obligation_file_hash
  ON obligation_accruals (company_id, source_file_hash)
  WHERE source_file_hash IS NOT NULL AND source_file_hash <> '';

CREATE INDEX IF NOT EXISTS ix_obligation_open
  ON obligation_accruals (company_id, obligation_type, status, period_key);

-- obligation_accrual_lines
CREATE TABLE IF NOT EXISTS obligation_accrual_lines (
  id TEXT PRIMARY KEY,
  accrual_id TEXT NOT NULL REFERENCES obligation_accruals(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL,
  law_code TEXT,
  description TEXT,
  principal_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  incentive_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  cancellation_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  penalty_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  late_fee_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  payable_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  accounting_role TEXT,
  mapped_account_code TEXT,
  mapping_status TEXT NOT NULL DEFAULT 'PENDING',
  source_text TEXT,
  source_page INTEGER,
  confidence NUMERIC(6,2) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_accrual_lines_accrual
  ON obligation_accrual_lines (accrual_id);

-- obligation_payment_matches
CREATE TABLE IF NOT EXISTS obligation_payment_matches (
  id TEXT PRIMARY KEY,
  accrual_id TEXT NOT NULL REFERENCES obligation_accruals(id) ON DELETE CASCADE,
  movement_id TEXT NOT NULL,
  matched_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  principal_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  incentive_income_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  incentive_cancellation_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  penalty_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  late_fee_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  unmatched_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  match_type TEXT,
  match_status TEXT,
  confidence NUMERIC(6,2) DEFAULT 0,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_payment_matches_accrual
  ON obligation_payment_matches (accrual_id);

CREATE INDEX IF NOT EXISTS ix_payment_matches_movement
  ON obligation_payment_matches (movement_id);
