/**
 * Belgeye özel hesap çözüm overlay — session dışı kalıcılık.
 * Öncelik: document resolution → firma hafızası → öneri → inceleme.
 */

export function publicBankResolutionView(row = {}) {
  if (!row || typeof row !== "object") return null;
  return {
    id: String(row.id || ""),
    companyId: String(row.company_id || row.companyId || ""),
    sourceId: String(row.source_id || row.sourceId || ""),
    sourceMovementId: String(
      row.source_movement_id || row.sourceMovementId || ""
    ),
    lucaLeg: String(row.luca_leg || row.lucaLeg || ""),
    accountCode: String(row.account_code || row.accountCode || "").trim(),
    accountName: String(row.account_name || row.accountName || "").trim(),
    direction: String(row.direction || "").trim().toUpperCase(),
    analysisKey: String(row.analysis_key || row.analysisKey || ""),
    transactionType: String(
      row.transaction_type || row.transactionType || ""
    ),
    decisionType: String(row.decision_type || row.decisionType || ""),
    learnForCompany: Boolean(row.learn_for_company ?? row.learnForCompany),
    userApproved: row.user_approved !== false && row.userApproved !== false,
    status: String(row.status || "active"),
    revision: Number(row.revision || 1) || 1,
    sourceRevision: Number(row.source_revision || row.sourceRevision || 1) || 1,
    supersedesResolutionId: String(
      row.supersedes_resolution_id || row.supersedesResolutionId || ""
    ),
    auditNote: String(row.audit_note || row.auditNote || ""),
    createdBy: String(row.created_by || row.createdBy || ""),
    createdAt: row.created_at || row.createdAt || null,
    undoneAt: row.undone_at || row.undoneAt || null,
  };
}

export function buildResolutionLookup(resolutions = []) {
  const byMovementId = new Map();
  for (const raw of resolutions || []) {
    const view = publicBankResolutionView(raw);
    if (!view?.sourceMovementId || !view.accountCode) continue;
    if (view.status && view.status !== "active") continue;
    const leg = view.lucaLeg || "";
    const key = `${view.sourceMovementId}|${leg}`;
    const prev = byMovementId.get(key);
    if (!prev || Number(view.revision) >= Number(prev.revision)) {
      byMovementId.set(key, view);
    }
    // Prefer empty-leg as default for the movement
    if (!leg) {
      const bare = view.sourceMovementId;
      const prevBare = byMovementId.get(bare);
      if (!prevBare || Number(view.revision) >= Number(prevBare.revision)) {
        byMovementId.set(bare, view);
      }
    }
  }
  return byMovementId;
}

export function lookupDocumentResolution(
  lookup,
  { sourceMovementId = "", lucaLeg = "" } = {}
) {
  if (!lookup || typeof lookup.get !== "function") return null;
  const mid = String(sourceMovementId || "").trim();
  if (!mid) return null;
  const leg = String(lucaLeg || "").trim();
  return (
    lookup.get(`${mid}|${leg}`) ||
    lookup.get(mid) ||
    lookup.get(`${mid}|`) ||
    null
  );
}

/**
 * Extract stable sourceMovementId from luca / movement row.
 */
export function resolveSourceMovementId(row = {}) {
  const stable = String(
    row.sourceMovementId ||
      row.source_movement_id ||
      row.sourceRowId ||
      row.source_row_id ||
      row._movementId ||
      row.movementId ||
      ""
  ).trim();
  if (stable) return stable;
  // Luca satır id'si (sl-*, luca-*) hareket kimliği değildir — persist anahtarı olmaz
  const fallback = String(row.id || "").trim();
  if (!fallback) return "";
  if (/^(sl-|luca-|manual-|preview-)/i.test(fallback)) return "";
  return fallback;
}

function sanitizeResolutionDirection(value = "") {
  const d = String(value || "").trim().toUpperCase();
  const allowed = new Set([
    "",
    "GIRIS",
    "CIKIS",
    "BORC",
    "ALACAK",
    "GELEN",
    "GIDEN",
  ]);
  if (allowed.has(d)) return d;
  if (d === "IN" || d === "CREDIT" || d === "ALACAKLI") return "GIRIS";
  if (d === "OUT" || d === "DEBIT" || d === "BORCLU") return "CIKIS";
  return "";
}

/**
 * Apply document resolutions onto luca rows (empty hesap only, unless force).
 */
export function applyDocumentResolutionsToLucaRows(
  rows = [],
  resolutions = [],
  { force = false } = {}
) {
  const lookup = buildResolutionLookup(resolutions);
  if (!lookup.size) {
    return { lucaRows: rows, applied: 0 };
  }
  let applied = 0;
  const next = (rows || []).map((row) => {
    const mid = resolveSourceMovementId(row);
    const hit = lookupDocumentResolution(lookup, {
      sourceMovementId: mid,
      lucaLeg: row.lucaLeg || row.leg || "",
    });
    if (!hit?.accountCode) return row;
    const hasCode = String(row.hesapKodu || "").trim();
    if (hasCode && !force) return row;
    applied += 1;
    return {
      ...row,
      hesapKodu: hit.accountCode,
      hesapAdi: hit.accountName || row.hesapAdi || "",
      riskDurumu: "",
      missingHesapCategory: "",
      documentResolutionApplied: true,
      documentResolutionId: hit.id,
      documentResolutionRevision: hit.revision,
      kontrolNotu: [
        String(row.kontrolNotu || "")
          .replace(/Hesap eşleşmesi bulunamadı/gi, "")
          .replace(/Kural bulunamadı/gi, "")
          .replace(/Cari hesap bulunamadı[^.|]*/gi, "")
          .replace(/\s+\|\s+/g, " | ")
          .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
          .trim(),
        "Belge kararı: onaylı hesap uygulandı",
      ]
        .filter(Boolean)
        .join(" | "),
    };
  });
  return { lucaRows: next, applied };
}

/**
 * Stamp counterAccountCode on movements before accounting analysis.
 */
export function applyDocumentResolutionsToMovements(
  movements = [],
  resolutions = []
) {
  const lookup = buildResolutionLookup(resolutions);
  if (!lookup.size) return movements;
  return (movements || []).map((m) => {
    const mid = resolveSourceMovementId(m);
    const hit = lookupDocumentResolution(lookup, { sourceMovementId: mid });
    if (!hit?.accountCode) return m;
    // Yalnız karşı hesap — statement/banka accountCode'unu 193 vb. ile ezme
    if (String(m.counterAccountCode || "").trim()) return m;
    return {
      ...m,
      counterAccountCode: hit.accountCode,
      accountName: hit.accountName || m.accountName || "",
      documentResolutionApplied: true,
      documentResolutionId: hit.id,
      _accountingHint: "document_resolution",
    };
  });
}

export function buildResolutionPayloadsFromApply({
  companyId = "",
  sourceId = "",
  accountCode = "",
  accountName = "",
  learn = false,
  group = null,
  lucaRows = [],
  sourceRevision = 1,
  createdBy = "",
} = {}) {
  const code = String(accountCode || "").trim();
  const cid = String(companyId || "").trim();
  const sid = String(sourceId || "").trim();
  if (!code || !cid || !sid || !group) return [];

  const targetIds = new Set(
    (group.rowIds || []).map((id) => String(id || "").trim()).filter(Boolean)
  );
  if (targetIds.size === 0 && group.seedRow?.id) {
    targetIds.add(String(group.seedRow.id));
  }

  const byMovement = new Map();
  const pushPayload = (mid, row = {}) => {
    if (!mid || byMovement.has(mid)) return;
    byMovement.set(mid, {
      company_id: cid,
      source_id: sid,
      source_movement_id: mid,
      luca_leg: "",
      account_code: code,
      account_name: String(accountName || "").trim(),
      direction: sanitizeResolutionDirection(
        group.direction || row.direction || ""
      ),
      analysis_key: String(
        row.analysisKey ||
          group.seedRow?.analysisKey ||
          row.detayAciklama ||
          ""
      ).trim(),
      transaction_type: String(
        row.transactionType || group.seedRow?.transactionType || ""
      ).trim(),
      decision_type: "DIRECT_ACCOUNT",
      learn_for_company: Boolean(learn),
      user_approved: true,
      status: "active",
      source_revision: Number(sourceRevision) || 1,
      audit_note: "cari-resolution-center:apply",
      created_by: String(createdBy || ""),
    });
  };

  for (const row of lucaRows || []) {
    if (!targetIds.has(String(row?.id || "").trim())) continue;
    pushPayload(resolveSourceMovementId(row), row);
  }

  // Transactions / learnSeed — luca id eşleşmesi kaçsa bile stabil hareket kimliği
  if (Array.isArray(group.transactions)) {
    for (const tx of group.transactions) {
      pushPayload(
        resolveSourceMovementId(tx) ||
          resolveSourceMovementId(tx?.learnSeed || {}),
        tx?.learnSeed || tx
      );
    }
  }
  if (group.seedRow) {
    pushPayload(
      resolveSourceMovementId(group.seedRow) ||
        resolveSourceMovementId(group.seedRow?.learnSeed || {}),
      group.seedRow
    );
  }

  return [...byMovement.values()];
}

export function collectSourceMovementIdsFromUndoSnapshot(rowSnapshot = []) {
  const ids = new Set();
  for (const snap of rowSnapshot || []) {
    const mid = String(
      snap?.sourceMovementId ||
        snap?.source_movement_id ||
        snap?.sourceRowId ||
        ""
    ).trim();
    if (mid) ids.add(mid);
  }
  return [...ids];
}
