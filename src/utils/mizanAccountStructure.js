import { BORC_ALACAK_TOLERANCE } from "@/src/config/eDefterKontrolDefaults";
import {
  normalizeAccountCodeForComparison,
  normalizeParserText,
} from "@/src/utils/textNormalize";

export const MIZAN_ACCOUNT_ROLE = {
  LEAF: "LEAF",
  PARENT: "PARENT",
};

function compactText(value = "") {
  return normalizeParserText(value).replace(/\s+/g, "");
}

/** Segment tokens — Unicode letters preserved (NFC, tr-TR case as stored). */
export function splitAccountCodeSegments(code = "") {
  return String(code ?? "")
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, "")
    .normalize("NFC")
    .trim()
    .split(/[./]/)
    .filter(Boolean);
}

/** True when parent is a strict hierarchical prefix of child (segment or compact key). */
export function isHierarchicalAccountPrefix(parent = "", child = "") {
  if (!parent || !child || parent === child) return false;

  const parentSegs = splitAccountCodeSegments(parent);
  const childSegs = splitAccountCodeSegments(child);
  if (parentSegs.length < childSegs.length) {
    let segmentMatch = true;
    for (let i = 0; i < parentSegs.length; i += 1) {
      if (parentSegs[i] !== childSegs[i]) {
        segmentMatch = false;
        break;
      }
    }
    if (segmentMatch) return true;
  }

  const parentCompact = normalizeAccountCodeForComparison(parent);
  const childCompact = normalizeAccountCodeForComparison(child);
  return parentCompact !== childCompact && childCompact.startsWith(parentCompact);
}

/** Mizan grand-total / summary row (kept as evidence, not an account). */
export function isMizanTotalsRow(row = {}) {
  const code = String(row.hesapKodu || "").trim();
  const name = String(row.hesapAdi || row.aciklama || "").trim();
  const combined = compactText(`${code} ${name}`);
  if (combined.includes("GENELTOPLAM")) return true;
  if (/^TOPLAM:?$/i.test(code.trim())) return true;
  return false;
}

/** Rows that must not become movement/account reconcile targets. */
export function isMizanNonAccountRow(row = {}) {
  if (isMizanTotalsRow(row)) return true;

  const code = String(row.hesapKodu || "").trim();
  const name = String(row.hesapAdi || row.aciklama || "").trim();
  const combined = `${code} ${name}`.toLocaleUpperCase("tr-TR");

  if (!code && !name && !row.borc && !row.alacak) return true;

  if (/^HESAP\s*(KODU|KOD|ADI)?$/.test(combined.replace(/\s+/g, " ").trim())) {
    return true;
  }

  const compactCode = normalizeAccountCodeForComparison(code);
  if (!compactCode && /TOPLAM/.test(combined)) return true;

  return false;
}

export function classifyMizanAccountCodes(codes = []) {
  const uniqueCodes = [...new Set(codes.filter(Boolean))];
  const parentCodes = new Set();
  for (const code of uniqueCodes) {
    for (const other of uniqueCodes) {
      if (isHierarchicalAccountPrefix(code, other)) {
        parentCodes.add(code);
        break;
      }
    }
  }
  const leafCodes = new Set(uniqueCodes.filter((code) => !parentCodes.has(code)));
  return { parentCodes, leafCodes, accountCount: uniqueCodes.length };
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

/** Split raw mizan parse output into account rows, totals evidence, and hierarchy roles. */
export function structureMizanParseResult(rawRows = []) {
  const skipRows = [];
  const accountRows = [];
  let mizanTotals = null;

  for (const row of rawRows) {
    if (isMizanTotalsRow(row)) {
      mizanTotals = {
        label: String(row.hesapKodu || row.hesapAdi || "GENEL TOPLAM").trim(),
        borc: roundMoney(row.borc),
        alacak: roundMoney(row.alacak),
        source: "GENEL_TOPLAM_ROW",
      };
      skipRows.push(row);
      continue;
    }
    if (isMizanNonAccountRow(row)) {
      skipRows.push(row);
      continue;
    }
    accountRows.push(row);
  }

  const codes = accountRows.map((row) => row.hesapKodu);
  const { parentCodes, leafCodes, accountCount } = classifyMizanAccountCodes(codes);
  const rows = accountRows.map((row) => ({
    ...row,
    mizanAccountRole: parentCodes.has(row.hesapKodu)
      ? MIZAN_ACCOUNT_ROLE.PARENT
      : MIZAN_ACCOUNT_ROLE.LEAF,
  }));

  return {
    rows,
    mizanTotals,
    skipRows,
    stats: {
      parsedRowCount: rawRows.length,
      accountRowCount: accountRows.length,
      skipRowCount: skipRows.length,
      parentCount: parentCodes.size,
      leafCount: leafCodes.size,
      accountCount,
      totalsRowCount: mizanTotals ? 1 : 0,
    },
  };
}

export function filterLeafMizanRows(rows = []) {
  return (rows || []).filter((row) => row.mizanAccountRole !== MIZAN_ACCOUNT_ROLE.PARENT);
}

/** Grand total evidence: mizan GENEL TOPLAM ↔ muavin movement totals. */
export function verifyMizanMuavinGrandTotals({
  muavinRows = [],
  mizanTotals = null,
  leafMizanRows = [],
  tolerance = BORC_ALACAK_TOLERANCE,
} = {}) {
  const muavinBorc = roundMoney(
    (muavinRows || []).reduce((sum, row) => sum + roundMoney(row.borc), 0)
  );
  const muavinAlacak = roundMoney(
    (muavinRows || []).reduce((sum, row) => sum + roundMoney(row.alacak), 0)
  );

  let mizanBorc = roundMoney(mizanTotals?.borc);
  let mizanAlacak = roundMoney(mizanTotals?.alacak);
  let source = mizanTotals ? "GENEL_TOPLAM_ROW" : "LEAF_SUM";

  if (!mizanTotals) {
    mizanBorc = roundMoney(
      (leafMizanRows || []).reduce((sum, row) => sum + roundMoney(row.borc), 0)
    );
    mizanAlacak = roundMoney(
      (leafMizanRows || []).reduce((sum, row) => sum + roundMoney(row.alacak), 0)
    );
  }

  const borcDelta = roundMoney(muavinBorc - mizanBorc);
  const alacakDelta = roundMoney(muavinAlacak - mizanAlacak);
  const borcMatched = Math.abs(borcDelta) <= tolerance;
  const alacakMatched = Math.abs(alacakDelta) <= tolerance;

  return {
    matched: borcMatched && alacakMatched,
    source,
    muavin: { borc: muavinBorc, alacak: muavinAlacak },
    mizan: { borc: mizanBorc, alacak: mizanAlacak },
    delta: { borc: borcDelta, alacak: alacakDelta },
    tolerance,
  };
}
