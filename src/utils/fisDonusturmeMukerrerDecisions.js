/**
 * Fiş Dönüştürme — mükerrer fiş grupları ve oturum kararları.
 * Kalıcı hafıza / DB yok; yalnız çalışma oturumu.
 */

import {
  compareCanonicalFisNoKeys,
  displayFisNo,
  fisNosCanonicallyEqual,
} from "@/src/utils/canonicalFisNo";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { toCanonicalVoucherRow } from "@/src/utils/fisKontrolMerkezi";

export const MUKERRER_DECISION_KEEP_FIRST = "keep_first";
export const MUKERRER_DECISION_KEEP_ALL = "keep_all";
export const MUKERRER_DECISION_MANUAL = "manual";

export const MUKERRER_EXPORT_EXCLUDED_LABEL = "Export dışı — kullanıcı kararı";

export const FIS_DONUSTURME_MUKERRER_UNRESOLVED_CODE = "MUKERRER_UNRESOLVED";

function fisKey(value) {
  return displayFisNo(value);
}

function sortFisNos(fisNos = []) {
  return [...new Set((fisNos || []).map(fisKey).filter(Boolean))].sort(
    compareCanonicalFisNoKeys
  );
}

function findRoot(parent, x) {
  if (!parent.has(x)) parent.set(x, x);
  while (parent.get(x) !== x) {
    parent.set(x, parent.get(parent.get(x)));
    x = parent.get(x);
  }
  return x;
}

function union(parent, a, b) {
  const ra = findRoot(parent, a);
  const rb = findRoot(parent, b);
  if (ra !== rb) parent.set(ra, rb);
}

export function buildMukerrerGroupId(fisNos = []) {
  return sortFisNos(fisNos).join("|");
}

/**
 * Çapraz-fiş identity fingerprint’lerinden mükerrer fiş grupları üretir.
 */
export function buildMukerrerFisGroups(rows = [], context = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const firmaId = String(context.firmaId || context.companyId || "").trim();
  const byIdentity = new Map();

  for (const row of list) {
    const canon = toCanonicalVoucherRow(row, { firmaId });
    const key = canon.identityKey;
    if (!key) continue;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(row);
  }

  const parent = new Map();
  const linkingKeys = [];

  for (const [identityKey, keyedRows] of byIdentity.entries()) {
    const fisNos = sortFisNos(keyedRows.map((row) => row.fisNo));
    if (fisNos.length < 2) continue;
    linkingKeys.push(identityKey);
    for (let i = 1; i < fisNos.length; i += 1) {
      union(parent, fisNos[0], fisNos[i]);
    }
  }

  const buckets = new Map();
  for (const fis of parent.keys()) {
    const root = findRoot(parent, fis);
    if (!buckets.has(root)) buckets.set(root, new Set());
    buckets.get(root).add(fis);
  }

  const groups = [];
  for (const fisSet of buckets.values()) {
    const fisNos = sortFisNos([...fisSet]);
    if (fisNos.length < 2) continue;

    const groupRows = list.filter((row) =>
      fisNos.some((fis) => fisNosCanonicallyEqual(fis, row.fisNo))
    );

    const vouchers = fisNos.map((fisNo) => {
      const voucherRows = groupRows.filter((row) =>
        fisNosCanonicallyEqual(fisNo, row.fisNo)
      );
      const first = voucherRows[0] || {};
      const borc = voucherRows.reduce(
        (sum, row) => sum + (parseMoneyTR(row.borc) || 0),
        0
      );
      const alacak = voucherRows.reduce(
        (sum, row) => sum + (parseMoneyTR(row.alacak) || 0),
        0
      );
      return {
        fisNo,
        fisTarihi: first.fisTarihi || "",
        belgeTuru: String(first.belgeTuru || "").trim().toUpperCase(),
        aciklama: String(
          first.fisAciklama || first.detayAciklama || first.aciklama || ""
        ).trim(),
        hesapKodlari: voucherRows.map((row) => String(row.hesapKodu || "").trim()),
        borc,
        alacak,
        rowCount: voucherRows.length,
        balanced: Math.abs(borc - alacak) < 0.005,
      };
    });

    groups.push({
      id: buildMukerrerGroupId(fisNos),
      fisNos,
      firstFisNo: fisNos[0] || "",
      vouchers,
      rowCount: groupRows.length,
      identityKeyCount: linkingKeys.filter((key) => {
        const keyed = byIdentity.get(key) || [];
        return keyed.some((row) =>
          fisNos.some((fis) => fisNosCanonicallyEqual(fis, row.fisNo))
        );
      }).length,
    });
  }

  return groups.sort((a, b) => compareCanonicalFisNoKeys(a.firstFisNo, b.firstFisNo));
}

export function isMukerrerDecisionResolved(decision) {
  if (!decision || !decision.mode) return false;
  if (decision.mode === MUKERRER_DECISION_KEEP_ALL) return true;
  if (decision.mode === MUKERRER_DECISION_KEEP_FIRST) {
    return Boolean(decision.keepFisNos?.length);
  }
  if (decision.mode === MUKERRER_DECISION_MANUAL) {
    return Array.isArray(decision.keepFisNos) && decision.keepFisNos.length > 0;
  }
  return false;
}

export function resolveMukerrerKeepFisNos(group, decision) {
  const fisNos = sortFisNos(group?.fisNos || []);
  if (!decision?.mode) return null;

  if (decision.mode === MUKERRER_DECISION_KEEP_ALL) {
    return fisNos;
  }

  if (decision.mode === MUKERRER_DECISION_KEEP_FIRST) {
    return fisNos[0] ? [fisNos[0]] : [];
  }

  if (decision.mode === MUKERRER_DECISION_MANUAL) {
    const selected = sortFisNos(decision.keepFisNos || []);
    return selected.filter((fis) =>
      fisNos.some((member) => fisNosCanonicallyEqual(member, fis))
    );
  }

  return null;
}

export function createMukerrerDecision(mode, keepFisNos = [], group = null) {
  if (mode === MUKERRER_DECISION_KEEP_FIRST) {
    const first = sortFisNos(group?.fisNos || keepFisNos)[0];
    return {
      mode,
      keepFisNos: first ? [first] : [],
    };
  }
  if (mode === MUKERRER_DECISION_KEEP_ALL) {
    return {
      mode,
      keepFisNos: sortFisNos(group?.fisNos || keepFisNos),
    };
  }
  if (mode === MUKERRER_DECISION_MANUAL) {
    return {
      mode,
      keepFisNos: sortFisNos(keepFisNos),
    };
  }
  return null;
}

export function getExcludedFisNosFromMukerrerDecisions(groups = [], decisions = {}) {
  const excluded = new Set();
  for (const group of groups) {
    const decision = decisions[group.id];
    if (!isMukerrerDecisionResolved(decision)) continue;
    const keep = new Set(resolveMukerrerKeepFisNos(group, decision) || []);
    for (const fis of group.fisNos) {
      if (![...keep].some((kept) => fisNosCanonicallyEqual(kept, fis))) {
        excluded.add(fisKey(fis));
      }
    }
  }
  return [...excluded].sort(compareCanonicalFisNoKeys);
}

export function isFisExcludedFromMukerrerExport(fisNo, excludedFisNos = []) {
  const key = fisKey(fisNo);
  return (excludedFisNos || []).some((excluded) =>
    fisNosCanonicallyEqual(excluded, key)
  );
}

export function filterRowsForMukerrerExport(rows = [], groups = [], decisions = {}) {
  const excluded = getExcludedFisNosFromMukerrerDecisions(groups, decisions);
  if (!excluded.length) return Array.isArray(rows) ? [...rows] : [];
  return (rows || []).filter(
    (row) => !isFisExcludedFromMukerrerExport(row.fisNo, excluded)
  );
}

export function listUnresolvedMukerrerGroups(groups = [], decisions = {}) {
  return (groups || []).filter(
    (group) => !isMukerrerDecisionResolved(decisions[group.id])
  );
}

export function assertMukerrerDecisionsForExport(groups = [], decisions = {}) {
  const unresolved = listUnresolvedMukerrerGroups(groups, decisions);
  if (!unresolved.length) {
    return { ok: true, code: "OK", message: "", unresolvedGroups: [] };
  }

  const parts = unresolved.map((group) => {
    const fisList = group.fisNos.join(", ");
    return `Grup ${group.id}: fiş ${fisList}`;
  });

  return {
    ok: false,
    code: FIS_DONUSTURME_MUKERRER_UNRESOLVED_CODE,
    message: `Çözülmemiş mükerrer fiş grubu var. Karar verin: ${parts.join(" | ")}`,
    unresolvedGroups: unresolved,
  };
}

export function collectFisNosMissingAciklama(rows = []) {
  const byFis = new Map();
  for (const row of rows || []) {
    const detay = String(row.detayAciklama || "").trim();
    const fisAcik = String(row.fisAciklama || "").trim();
    const acik = String(row.aciklama || "").trim();
    if (detay || fisAcik || acik) continue;
    const fis = fisKey(row.fisNo);
    if (!fis) continue;
    if (!byFis.has(fis)) byFis.set(fis, []);
    byFis.get(fis).push(row);
  }
  return [...byFis.entries()]
    .map(([fisNo, emptyRows]) => ({ fisNo, emptyRows, count: emptyRows.length }))
    .sort((a, b) => compareCanonicalFisNoKeys(a.fisNo, b.fisNo));
}

/**
 * Yalnız boş açıklamalı satırlara yazar; dolu satırlara dokunmaz.
 */
export function applyFisAciklamaToEmptyRows(rows = [], fisNo, aciklama) {
  const text = String(aciklama || "").trim();
  if (!text) {
    return { rows: Array.isArray(rows) ? [...rows] : [], updatedCount: 0 };
  }

  let updatedCount = 0;
  const next = (rows || []).map((row) => {
    if (!fisNosCanonicallyEqual(row.fisNo, fisNo)) return row;
    const detay = String(row.detayAciklama || "").trim();
    const fisAcik = String(row.fisAciklama || "").trim();
    const acik = String(row.aciklama || "").trim();
    if (detay || fisAcik || acik) return row;
    updatedCount += 1;
    return {
      ...row,
      fisAciklama: text,
      detayAciklama: text,
      aciklama: text,
      manuallyEdited: true,
    };
  });

  return { rows: next, updatedCount };
}

export function annotateRowsWithMukerrerExportExclusion(
  rows = [],
  groups = [],
  decisions = {}
) {
  const excluded = new Set(getExcludedFisNosFromMukerrerDecisions(groups, decisions));
  return (rows || []).map((row) => {
    const excludedNow = isFisExcludedFromMukerrerExport(row.fisNo, [...excluded]);
    if (!excludedNow) {
      if (!row.mukerrerExportExcluded) return row;
      const { mukerrerExportExcluded: _drop, ...rest } = row;
      return rest;
    }
    return {
      ...row,
      mukerrerExportExcluded: true,
    };
  });
}
