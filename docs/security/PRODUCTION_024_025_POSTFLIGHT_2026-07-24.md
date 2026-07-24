# Production 024/025 Postflight Proof — 2026-07-24

## Scope

Production migrations `024_security_dr_hardening.sql` and
`025_security_view_indexes_grants.sql` were applied through the Supabase SQL
Editor against project `ttxigznwcjvrlzuppbro` (`main`, PRODUCTION).

Both migrations completed with:

- `Success. No rows returned`

## Read-only postflight

Postflight used:

```sql
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

-- STAGING_SCHEMA_PREFLIGHT_READ_ONLY.sql

ROLLBACK;
```

Export evidence:

- `Supabase Snippet Untitled query (8).csv`
- Total rows: 177

## Result summary

| Status | Count |
|---|---:|
| READY | 95 |
| ALREADY_APPLIED | 75 |
| MANUAL_REVIEW | 7 |
| MISSING | 0 |
| CONFLICT | 0 |

## Migration result

| Migration | Result |
|---|---|
| 020 | READY |
| 021 | READY |
| 022 | READY |
| 023 | READY |
| 024 | ALREADY_APPLIED |
| 025 | ALREADY_APPLIED |

`MISSING=0` and `CONFLICT=0`; therefore the 024/025 schema postflight passed.

## Manual-review rows

The seven `MANUAL_REVIEW` rows are informational checks that require
operational or live-fixture evidence. They do not represent schema conflicts
or missing 024/025 objects.

They remain tracked separately for:

- production admin AND-gate validation;
- tenant A/B isolation validation;
- GİB credential tenant-guard validation;
- production restore exercise;
- operational monitoring and smoke evidence.

## Safety

- Postflight SQL ran in a read-only transaction and ended with `ROLLBACK`.
- This document records evidence only.
- No production deploy was performed by this documentation change.
- No additional production SQL mutation was performed by this documentation
  change.
