/**
 * Soft delete altyapısı — Güvenlik Faz 1.
 * Fiziksel silme yerine deleted_at / deleted_by kullanımı için yardımcılar.
 */

export const SOFT_DELETE_TABLES = [
  "companies",
  "learning_memory",
  "unrecognized_transactions",
  "normalized_financial_transactions",
  "learned_bank_rules",
  "reconciliation_matches",
  "official_notifications",
];

/**
 * Soft delete patch nesnesi üretir.
 */
export function buildSoftDeletePatch(actor = {}) {
  const deletedBy =
    actor.email ||
    actor.id ||
    actor.actorEmail ||
    actor.actor_email ||
    "system";

  return {
    deleted_at: new Date().toISOString(),
    deleted_by: String(deletedBy).trim(),
  };
}

/**
 * Soft delete geri alma patch'i.
 */
export function buildSoftRestorePatch() {
  return {
    deleted_at: null,
    deleted_by: null,
  };
}

/** Aktif kayıt filtresi — Supabase query builder */
export function excludeSoftDeleted(query) {
  if (!query?.is) return query;
  return query.is("deleted_at", null);
}

/** learning_memory status=deleted ile uyumlu birleşik filtre */
export function isRowSoftDeleted(row = {}) {
  if (row.deleted_at) return true;
  const status = String(row.status || "").toLowerCase();
  return status === "deleted";
}
