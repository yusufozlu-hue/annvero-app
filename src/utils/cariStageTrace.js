/**
 * Salt-okunur BİLET stage trace — PII yok.
 * Yalnız canonical fingerprint fp:a1e58d49 (cm:BILETDUK|GIRIS) izlenir.
 * window.__ANNVERO_CARI_STAGE__ — production yazmaz, eşleştirmeyi değiştirmez.
 */

import {
  buildCariMemoryCanonicalKey,
  fingerprintCariMemoryKey,
  traceAccountMemoryLookup,
} from "@/src/utils/accountMemoryV2";

function recordCanonicalKey(record = {}) {
  return (
    String(record.canonicalAnalysisKey || "").trim() ||
    buildCariMemoryCanonicalKey(
      record.analysisKey || record.normalizedDescription,
      record.direction
    )
  );
}

export const CARI_STAGE_WINDOW_KEY = "__ANNVERO_CARI_STAGE__";
/** cm:BILETDUK|GIRIS */
export const CARI_STAGE_TARGET_CANONICAL_FP = "fp:a1e58d49";
export const CARI_STAGE_MAX_TRACKED = 2;

/** @type {null | {
 *   hydrate: object,
 *   tracked: Map<string, object>,
 *   beforeHesapByLeg: Map<string, string>,
 *   applyRejectByLeg: Map<string, string>,
 * }} */
let state = null;

function emptyPublish() {
  return {
    targetCanonicalFp: CARI_STAGE_TARGET_CANONICAL_FP,
    hydrate: null,
    movements: [],
  };
}

function publish() {
  if (typeof window === "undefined") return;
  if (!state) {
    window[CARI_STAGE_WINDOW_KEY] = emptyPublish();
    return;
  }
  const movements = [];
  for (const entry of state.tracked.values()) {
    movements.push({
      srFp: entry.srFp,
      "movement@mapExit": entry.mapExit || null,
      "luca@built": entry.lucaBuilt || [],
      "luca@afterAccountMemoryApply": entry.afterAccountMemory || [],
      "luca@afterPostSteps": entry.afterPostSteps || [],
      "final@missing": entry.finalMissing || [],
    });
  }
  window[CARI_STAGE_WINDOW_KEY] = {
    targetCanonicalFp: CARI_STAGE_TARGET_CANONICAL_FP,
    hydrate: state.hydrate,
    movements,
  };
}

function fpCode(value) {
  const text = String(value || "").trim();
  return text ? fingerprintCariMemoryKey(text) : "";
}

export function fingerprintSourceRowId(sourceRowId = "") {
  const id = String(sourceRowId || "").trim();
  if (!id) return "";
  return fingerprintCariMemoryKey(`sr:${id}`);
}

export function matchesCariStageTargetCanonical({
  analysisKey = "",
  description = "",
  direction = "",
} = {}) {
  const canon = buildCariMemoryCanonicalKey(
    analysisKey || description,
    direction
  );
  return fingerprintCariMemoryKey(canon) === CARI_STAGE_TARGET_CANONICAL_FP;
}

function inferLegType(row = {}) {
  const code = String(row.hesapKodu || "").trim();
  if (code.startsWith("102")) return "bank";
  return "cari";
}

function legKey(srFp, legType) {
  return `${srFp}|${legType}`;
}

function rowSrFp(row = {}) {
  const raw =
    row.sourceRowId ||
    row.sourceMovementId ||
    row._movementId ||
    row.id ||
    "";
  return fingerprintSourceRowId(raw);
}

/**
 * Her yeni pipeline işleminde çağrılır — önceki izi siler.
 */
export function resetCariStageTrace() {
  state = {
    hydrate: null,
    tracked: new Map(),
    beforeHesapByLeg: new Map(),
    applyRejectByLeg: new Map(),
  };
  publish();
}

/**
 * hydrate@process
 */
export function recordCariStageHydrate({
  buildCommit = "",
  accountMemoryReady = false,
  activeCount = 0,
  companyId = "",
  records = [],
} = {}) {
  if (!state) resetCariStageTrace();
  const companyScopeFp = fingerprintCariMemoryKey(
    String(companyId || "").trim() || "NO_COMPANY"
  );
  let canonicalRecordFound = false;
  for (const record of records || []) {
    if (record?.isActive === false) continue;
    if (String(record?.companyId || "") !== String(companyId || "")) continue;
    const canon =
      String(record.canonicalAnalysisKey || "").trim() ||
      recordCanonicalKey(record);
    if (fingerprintCariMemoryKey(canon) === CARI_STAGE_TARGET_CANONICAL_FP) {
      canonicalRecordFound = true;
      break;
    }
  }
  state.hydrate = {
    buildCommit: String(buildCommit || "").slice(0, 12),
    accountMemoryReady: Boolean(accountMemoryReady),
    activeCount: Number(activeCount || 0),
    companyScopeFp,
    canonicalFp: CARI_STAGE_TARGET_CANONICAL_FP,
    canonicalRecordFound,
  };
  publish();
}

function ensureTracked(srFp) {
  if (!state || !srFp) return null;
  if (state.tracked.has(srFp)) return state.tracked.get(srFp);
  if (state.tracked.size >= CARI_STAGE_MAX_TRACKED) return null;
  const entry = {
    srFp,
    mapExit: null,
    lucaBuilt: [],
    afterAccountMemory: [],
    afterPostSteps: [],
    finalMissing: [],
  };
  state.tracked.set(srFp, entry);
  return entry;
}

/**
 * movement@mapExit — description yalnız canonical eşleşme için; saklanmaz.
 */
export function recordCariStageMovementMapExit({
  sourceRowId = "",
  description = "",
  analysisKey = "",
  direction = "",
  transactionType = "",
  firmDecision = null,
  counterAccountCode = "",
  matchedMemoryId = null,
} = {}) {
  try {
    if (!state) return;
    if (
      !matchesCariStageTargetCanonical({
        analysisKey,
        description,
        direction,
      })
    ) {
      return;
    }
    const srFp = fingerprintSourceRowId(sourceRowId);
    if (!srFp) return;
    const entry = ensureTracked(srFp);
    if (!entry) return;

    const decision = firmDecision || {};
    let rejectReason = String(decision.rejectReason || "").trim();
    if (!rejectReason) {
      if (decision.mode === "auto") rejectReason = "";
      else if (decision.mode === "conflict") {
        rejectReason = "conflict_multiple_account_codes";
      } else if (decision.mode === "suggest") {
        rejectReason = "suggest_not_auto_eligible";
      } else if (decision.mode === "none") {
        rejectReason = "no_matching_memory_record";
      } else if (decision.mode) {
        rejectReason = `mode_${decision.mode}`;
      }
    }

    entry.mapExit = {
      srFp,
      direction: String(direction || "").trim().toUpperCase(),
      transactionType: String(transactionType || "").trim().toUpperCase(),
      analysisKeyFp: fpCode(analysisKey),
      lookupMode: String(decision.mode || ""),
      lookupAutoApply: Boolean(decision.autoApply),
      lookupRejectReason: rejectReason,
      counterAccountFp: fpCode(counterAccountCode),
      matchedMemoryIdPresent: Boolean(matchedMemoryId),
    };
    publish();
  } catch {
    /* teşhis pipeline’ı bozmasın */
  }
}

function collectTrackedLegs(rows = []) {
  if (!state?.tracked.size) return [];
  const out = [];
  for (const row of rows || []) {
    const srFp = rowSrFp(row);
    if (!srFp || !state.tracked.has(srFp)) continue;
    out.push({
      srFp,
      legType: inferLegType(row),
      direction: String(row.direction || "").trim().toUpperCase(),
      analysisKeyFp: fpCode(row.analysisKey),
      hesapFp: fpCode(row.hesapKodu),
      counterAccountFp: fpCode(row.karsiHesapKodu || row.karsiHesap),
      accountMemoryAutoFilled: Boolean(row.accountMemoryAutoFilled),
      riskDurumu: String(row.riskDurumu || "").trim(),
      hasHesap: Boolean(String(row.hesapKodu || "").trim()),
    });
  }
  return out;
}

/** luca@built */
export function recordCariStageLucaBuilt(rows = []) {
  try {
    if (!state?.tracked.size) return;
    const bySr = new Map();
    for (const leg of collectTrackedLegs(rows)) {
      if (!bySr.has(leg.srFp)) bySr.set(leg.srFp, []);
      bySr.get(leg.srFp).push({
        srFp: leg.srFp,
        legType: leg.legType,
        direction: leg.direction,
        analysisKeyFp: leg.analysisKeyFp,
        hesapFp: leg.hesapFp,
        counterAccountFp: leg.counterAccountFp,
      });
    }
    for (const [srFp, legs] of bySr) {
      const entry = state.tracked.get(srFp);
      if (entry) entry.lucaBuilt = legs;
    }
    publish();
  } catch {
    /* ignore */
  }
}

/** Apply öncesi hesap fingerprint snapshot */
export function beginCariStageAccountMemoryApply(rows = []) {
  try {
    if (!state?.tracked.size) return;
    state.beforeHesapByLeg = new Map();
    state.applyRejectByLeg = new Map();
    for (const leg of collectTrackedLegs(rows)) {
      state.beforeHesapByLeg.set(legKey(leg.srFp, leg.legType), leg.hesapFp);
    }
  } catch {
    /* ignore */
  }
}

/** luca@afterAccountMemoryApply — rejectReason yalnız boş kalan tracked bacaklar için salt-okunur lookup */
export function finishCariStageAccountMemoryApply(
  rows = [],
  { companyId = "", accountMemoryRecords = null } = {}
) {
  try {
    if (!state?.tracked.size) return;
    const bySr = new Map();
    for (const row of rows || []) {
      const srFp = rowSrFp(row);
      if (!srFp || !state.tracked.has(srFp)) continue;
      const legType = inferLegType(row);
      const key = legKey(srFp, legType);
      const beforeHesapFp = state.beforeHesapByLeg.get(key) || "";
      const afterHesapFp = fpCode(row.hesapKodu);
      const accountMemoryAutoFilled = Boolean(row.accountMemoryAutoFilled);
      let rejectReason = "";
      if (!String(row.hesapKodu || "").trim() && companyId) {
        const direction =
          String(row.direction || "").trim().toUpperCase() ||
          "";
        const lookup = traceAccountMemoryLookup(
          {
            companyId,
            analysisKey: row.analysisKey || "",
            direction,
            transactionType: row.transactionType || "",
            normalizedDescription:
              row.detayAciklama || row.fisAciklama || row.aciklama || "",
          },
          accountMemoryRecords || [],
          { allowAuto: true }
        );
        rejectReason = String(lookup.rejectReason || "");
      }
      if (!bySr.has(srFp)) bySr.set(srFp, []);
      bySr.get(srFp).push({
        srFp,
        legType,
        beforeHesapFp,
        afterHesapFp,
        accountMemoryAutoFilled,
        rejectReason,
      });
    }
    for (const [srFp, legs] of bySr) {
      const entry = state.tracked.get(srFp);
      if (entry) entry.afterAccountMemory = legs;
    }
    publish();
  } catch {
    /* ignore */
  }
}

/** luca@afterPostSteps */
export function recordCariStageAfterPostSteps(rows = []) {
  try {
    if (!state?.tracked.size) return;
    const bySr = new Map();
    for (const leg of collectTrackedLegs(rows)) {
      if (!bySr.has(leg.srFp)) bySr.set(leg.srFp, []);
      bySr.get(leg.srFp).push({
        srFp: leg.srFp,
        legType: leg.legType,
        hesapFp: leg.hesapFp,
      });
    }
    for (const [srFp, legs] of bySr) {
      const entry = state.tracked.get(srFp);
      if (entry) entry.afterPostSteps = legs;
    }
    publish();
  } catch {
    /* ignore */
  }
}

/** final@missing */
export function recordCariStageFinalMissing(rows = []) {
  try {
    if (!state?.tracked.size) return;
    const bySr = new Map();
    for (const leg of collectTrackedLegs(rows)) {
      const isMissing = !leg.hasHesap;
      let missingReasonCode = "OK";
      if (isMissing) {
        missingReasonCode =
          leg.riskDurumu === "HESAP_EKSIK" ? "HESAP_EKSIK" : "EMPTY_HESAP";
      }
      if (!bySr.has(leg.srFp)) bySr.set(leg.srFp, []);
      bySr.get(leg.srFp).push({
        srFp: leg.srFp,
        legType: leg.legType,
        hesapFp: leg.hesapFp,
        isMissing,
        riskDurumu: leg.riskDurumu || "",
        missingReasonCode,
      });
    }
    for (const [srFp, legs] of bySr) {
      const entry = state.tracked.get(srFp);
      if (entry) entry.finalMissing = legs;
    }
    publish();
  } catch {
    /* ignore */
  }
}

/** Test / okuma */
export function getCariStageTraceSnapshot() {
  if (typeof window !== "undefined" && window[CARI_STAGE_WINDOW_KEY]) {
    return window[CARI_STAGE_WINDOW_KEY];
  }
  if (!state) return emptyPublish();
  const movements = [];
  for (const entry of state.tracked.values()) {
    movements.push({
      srFp: entry.srFp,
      "movement@mapExit": entry.mapExit || null,
      "luca@built": entry.lucaBuilt || [],
      "luca@afterAccountMemoryApply": entry.afterAccountMemory || [],
      "luca@afterPostSteps": entry.afterPostSteps || [],
      "final@missing": entry.finalMissing || [],
    });
  }
  return {
    targetCanonicalFp: CARI_STAGE_TARGET_CANONICAL_FP,
    hydrate: state.hydrate,
    movements,
  };
}
