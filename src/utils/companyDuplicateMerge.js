/**
 * Deterministic duplicate-company merge planner (no I/O).
 * Primary: (1) Drive binding / document_index (2) more related weight (3) older created_at.
 */

import {
  extractCompanyMersis,
  extractCompanyVkn,
  isValidMersis,
  isValidVkn,
  shareSameStrongIdentity,
  areClearlyDistinctLegalEntities,
} from "./companyIdentity.js";

export function relatedDataWeight(companyReport) {
  const json = companyReport?.json_counts || {};
  const jsonSum = Object.values(json).reduce(
    (s, n) => s + (typeof n === "number" ? n : 0),
    0
  );
  const related = companyReport?.related_total || 0;
  const driveBonus = companyReport?.has_drive_binding ? 1000 : 0;
  // JSON operational rows weigh equally with related-table rows so a stub
  // with 1 memory row does not outrank a fully filled company card.
  return driveBonus + related + jsonSum;
}

export function choosePrimaryCompany(a, b) {
  const aDrive = Boolean(a?.has_drive_binding);
  const bDrive = Boolean(b?.has_drive_binding);
  if (aDrive !== bDrive) return aDrive ? a : b;

  const wa = relatedDataWeight(a);
  const wb = relatedDataWeight(b);
  if (wa !== wb) return wa > wb ? a : b;

  const ta = Date.parse(a?.created_at || 0) || 0;
  const tb = Date.parse(b?.created_at || 0) || 0;
  if (ta !== tb) return ta <= tb ? a : b;

  // stable tie-break
  return String(a.company_id) < String(b.company_id) ? a : b;
}

export function classifyDuplicatePair(a, b) {
  if (areClearlyDistinctLegalEntities(a, b)) {
    return { decision: "A", reason: "distinct_valid_identity" };
  }
  const va = extractCompanyVkn(a);
  const vb = extractCompanyVkn(b);
  const ma = extractCompanyMersis(a);
  const mb = extractCompanyMersis(b);
  const sameVkn = isValidVkn(va) && isValidVkn(vb) && va === vb;
  const sameMersis = isValidMersis(ma) && isValidMersis(mb) && ma === mb;
  if (sameVkn || shareSameStrongIdentity(a, b) || sameMersis) {
    return { decision: "B", reason: "same_strong_identity" };
  }
  if (
    (isValidVkn(va) || isValidMersis(ma)) &&
    !(isValidVkn(vb) || isValidMersis(mb))
  ) {
    return { decision: "B", reason: "identity_holder_a" };
  }
  if (
    (isValidVkn(vb) || isValidMersis(mb)) &&
    !(isValidVkn(va) || isValidMersis(ma))
  ) {
    return { decision: "B", reason: "identity_holder_b" };
  }
  return { decision: "C", reason: "insufficient_or_conflicting" };
}

/**
 * In-memory merge rehearsal for company JSON + related row maps.
 * Never deletes Drive roots; records secondary binding as review note.
 */
export function rehearseCompanyMerge({
  primary,
  duplicate,
  relatedMoves = {},
  primaryFolder = null,
  duplicateFolder = null,
}) {
  const primaryId = String(primary.id);
  const dupId = String(duplicate.id);
  const primaryData = {
    ...(primary.data || {}),
    isActive: true,
  };
  const dupData = { ...(duplicate.data || {}) };

  // Prefer non-empty arrays / strings from duplicate when primary empty
  for (const key of Object.keys(dupData)) {
    const pv = primaryData[key];
    const dv = dupData[key];
    if (pv == null || pv === "" || (Array.isArray(pv) && pv.length === 0)) {
      if (dv != null && dv !== "" && !(Array.isArray(dv) && dv.length === 0)) {
        primaryData[key] = dv;
      }
    }
  }

  const moved = {};
  for (const [table, ids] of Object.entries(relatedMoves)) {
    moved[table] = (ids || []).length;
  }

  let driveNote = null;
  if (primaryFolder?.root_folder_id && duplicateFolder?.root_folder_id) {
    if (
      String(primaryFolder.root_folder_id) !==
      String(duplicateFolder.root_folder_id)
    ) {
      driveNote = {
        action: "keep_both_roots",
        secondary: "inceleme_bekleyen_eski_kok",
        // no technical IDs in public note
      };
    }
  } else if (!primaryFolder?.root_folder_id && duplicateFolder?.root_folder_id) {
    driveNote = { action: "reattach_duplicate_binding_to_primary" };
  } else {
    driveNote = { action: "ensure_primary_tree" };
  }

  return {
    primaryId,
    duplicateId: dupId,
    primaryData: {
      ...primaryData,
      duplicate_of: undefined,
    },
    duplicateData: {
      ...dupData,
      isActive: false,
      duplicate_of: primaryId,
    },
    moved,
    driveNote,
    softDeactivate: true,
  };
}
