/**
 * Genel Muhasebe Kontrol orchestration — reuses eDefterKontrolEngine (no parallel motor).
 * Local one-click control; no DB/Drive persist in this surface.
 */
import {
  BORC_ALACAK_TOLERANCE,
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_ISSUE_SEVERITY,
  E_DEFTER_KAYNAK,
  E_DEFTER_KONTROL_GRUP,
  E_DEFTER_SONUC_SEVIYE,
} from "@/src/config/eDefterKontrolDefaults";
import {
  createEDefterIssue,
  detectLucaMultiAccountMuavinLayout,
  detectYevmiyeLayout,
  parseMizanSheet,
  parseMuavinSheet,
  parseYevmiyeSheet,
  runEDefterKontrolPipeline,
  YEVMIYE_LAYOUT,
} from "@/src/utils/eDefterKontrolEngine";
import {
  normalizeAccountCodeForComparison,
  normalizeParserText,
} from "@/src/utils/textNormalize";
import {
  buildGenelMuhasebeFindingsCatalog,
  summarizeGenelMuhasebeFindingsCatalog,
} from "@/src/utils/genelMuhasebeFindingsView";
import { parseDateTR } from "@/src/utils/formatDateTR";

export const GENEL_MUHASEBE_DOC_CLASS = {
  MUAVIN: "MUAVIN",
  YEVMIYE: "YEVMIYE",
  MIZAN: "MIZAN",
  E_DEFTER_XML: "E_DEFTER_XML",
  UNKNOWN: "UNKNOWN",
};

function compact(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function compactAccountCode(value) {
  return normalizeAccountCodeForComparison(value);
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function headerCorpus(sheetRows = []) {
  return (sheetRows.slice(0, 12) || [])
    .map((row) => (row || []).map((cell) => String(cell || "")).join(" "))
    .join(" | ")
    .toLocaleLowerCase("tr-TR");
}

function sampleAccountCodes(sheetRows = [], limit = 40) {
  const codes = new Set();
  for (const row of sheetRows.slice(1, 1 + limit)) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const text = String(cell || "").trim();
      // Chart codes: 3+ digit root (100, 320.01) — avoid mistaking amounts like "10".
      if (/^\d{3,}([./]\d{1,4}){0,5}$/.test(text)) codes.add(compactAccountCode(text));
    }
    if (codes.size > 8) break;
  }
  return codes;
}

/** Content-based document classification — never trust file name alone. */
export function classifyLedgerDocumentType(sheetRows = [], hints = {}) {
  if (hints.forceXml || hints.isXml) return GENEL_MUHASEBE_DOC_CLASS.E_DEFTER_XML;
  if (detectLucaMultiAccountMuavinLayout(sheetRows)) {
    return GENEL_MUHASEBE_DOC_CLASS.MUAVIN;
  }
  if (detectYevmiyeLayout(sheetRows) === YEVMIYE_LAYOUT.REPEATED_JOURNAL_BLOCK) {
    return GENEL_MUHASEBE_DOC_CLASS.YEVMIYE;
  }
  const head = headerCorpus(sheetRows);
  const has = (s) => head.includes(s);

  const hasBakiye =
    has("borç bakiyesi") ||
    has("borc bakiyesi") ||
    has("alacak bakiyesi") ||
    has("borç bak.") ||
    has("alacak bak.");
  const hasHesap = has("hesap");
  const hasBorcAlacak = (has("borç") || has("borc")) && has("alacak");
  const hasTarih = has("tarih");
  const hasFis = has("fiş no") || has("fis no") || has("yevmiye");
  const hasYevmiyeHint =
    has("yevmiye no") || has("yevmiye fiş") || (has("yevmiye") && !has("muavin"));
  const hasMuavinHint = has("muavin") || has("hesap hareket") || has("hareket döküm");
  const accountCodes = sampleAccountCodes(sheetRows);
  const singleAccountExtract = accountCodes.size === 1;

  if (hasBakiye && hasHesap && !hasFis) return GENEL_MUHASEBE_DOC_CLASS.MIZAN;
  // Strong signals first — never demote YEVMIYE to MUAVIN.
  if (hasYevmiyeHint && hasBorcAlacak) return GENEL_MUHASEBE_DOC_CLASS.YEVMIYE;
  if (hasMuavinHint && hasBorcAlacak) return GENEL_MUHASEBE_DOC_CLASS.MUAVIN;
  if (hasBorcAlacak && hasTarih && hasFis) {
    // Classic muavin: single-account extract without yevmiye column cues.
    if (singleAccountExtract && !has("yevmiye no")) return GENEL_MUHASEBE_DOC_CLASS.MUAVIN;
    return GENEL_MUHASEBE_DOC_CLASS.YEVMIYE;
  }
  if (hasBorcAlacak && hasHesap && !hasTarih) return GENEL_MUHASEBE_DOC_CLASS.MIZAN;
  return GENEL_MUHASEBE_DOC_CLASS.UNKNOWN;
}

/**
 * Refine class with UI slot hint only when content is ambiguous.
 * Never inherit MUAVIN from slot when content looks like YEVMIYE/MIZAN.
 */
export function refineDocumentClass(contentClass, preferredHint = "", sheetRows = []) {
  if (
    contentClass === GENEL_MUHASEBE_DOC_CLASS.YEVMIYE ||
    contentClass === GENEL_MUHASEBE_DOC_CLASS.MIZAN ||
    contentClass === GENEL_MUHASEBE_DOC_CLASS.E_DEFTER_XML ||
    contentClass === GENEL_MUHASEBE_DOC_CLASS.MUAVIN
  ) {
    return contentClass;
  }
  if (preferredHint === GENEL_MUHASEBE_DOC_CLASS.MIZAN) {
    return GENEL_MUHASEBE_DOC_CLASS.MIZAN;
  }
  if (preferredHint === GENEL_MUHASEBE_DOC_CLASS.MUAVIN) {
    const accounts = sampleAccountCodes(sheetRows);
    if (accounts.size <= 1) return GENEL_MUHASEBE_DOC_CLASS.MUAVIN;
  }
  // Fail-closed: ambiguous → YEVMIYE (missing opposite stays visible).
  return GENEL_MUHASEBE_DOC_CLASS.YEVMIYE;
}

function isValidYevmiyeMovementRow(row = {}) {
  return Boolean(String(row.hesapKodu || "").trim() && parseDateTR(row.tarih));
}

export function parseLedgerByDocumentClass(sheetRows = [], documentClass = "") {
  const cls = documentClass || classifyLedgerDocumentType(sheetRows);
  if (cls === GENEL_MUHASEBE_DOC_CLASS.MIZAN) {
    return { documentClass: cls, rows: parseMizanSheet(sheetRows).map((r) => ({ ...r, documentClass: cls })) };
  }
  if (cls === GENEL_MUHASEBE_DOC_CLASS.MUAVIN) {
    return {
      documentClass: cls,
      rows: parseMuavinSheet(sheetRows).map((r) => ({ ...r, documentClass: cls, kaynak: E_DEFTER_KAYNAK.MUAVIN })),
    };
  }
  if (cls === GENEL_MUHASEBE_DOC_CLASS.YEVMIYE) {
    return {
      documentClass: cls,
      rows: parseYevmiyeSheet(sheetRows).map((r) => ({ ...r, documentClass: cls, kaynak: E_DEFTER_KAYNAK.YEVMIYE })),
    };
  }
  // UNKNOWN: try yevmiye schema (safer fail-closed for counterpart) without claiming MUAVIN.
  const yev = parseYevmiyeSheet(sheetRows);
  if (yev.length) {
    return {
      documentClass: GENEL_MUHASEBE_DOC_CLASS.UNKNOWN,
      rows: yev.map((r) => ({ ...r, documentClass: GENEL_MUHASEBE_DOC_CLASS.UNKNOWN, kaynak: E_DEFTER_KAYNAK.YEVMIYE })),
    };
  }
  const mizan = parseMizanSheet(sheetRows);
  return {
    documentClass: GENEL_MUHASEBE_DOC_CLASS.UNKNOWN,
    rows: mizan.map((r) => ({ ...r, documentClass: GENEL_MUHASEBE_DOC_CLASS.UNKNOWN })),
  };
}

export function accountCodeFromPlanRow(account) {
  return String(
    account?.account_code ||
      account?.accountCode ||
      account?.hesapKodu ||
      account?.code ||
      ""
  ).trim();
}

export function buildAccountPlanCodeSet(accounts = []) {
  const set = new Set();
  for (const account of accounts || []) {
    const code = accountCodeFromPlanRow(account);
    if (!code) continue;
    set.add(code);
    set.add(compactAccountCode(code));
    const short = code.split(".")[0];
    if (short) set.add(short);
  }
  return set;
}

/** Period-end / technical / cross rows mixed into pipeline — not ledger movements. */
export function isSyntheticSystemFindingRow(row = {}) {
  const id = String(row?.id || "");
  return (
    id.startsWith("donem-sonu") ||
    id.startsWith("fis-gap") ||
    id.startsWith("teknik-") ||
    id.startsWith("vergisel-") ||
    id.startsWith("capraz-") ||
    id.startsWith("cross-")
  );
}

/** Account-level mizan ↔ muavin reconcile. Never treats mizan as voucher lines. */
export function reconcileMizanMuavin({ muavinRows = [], mizanRows = [], tolerance = BORC_ALACAK_TOLERANCE } = {}) {
  const hasMuavin = (muavinRows || []).length > 0;
  const hasMizan = (mizanRows || []).length > 0;
  if (!hasMuavin || !hasMizan) {
    return {
      status: "EVIDENCE_MISSING",
      code: E_DEFTER_ISSUE_CODE.MIZAN_MUAVIN_EVIDENCE_MISSING,
      matched: false,
      message: !hasMuavin && !hasMizan
        ? "Muavin ve mizan yüklenmedi; mutabakat yapılamadı."
        : !hasMuavin
          ? "Muavin yok; mizan ile mutabık denemez."
          : "Mizan yok; muavin ile mutabık denemez.",
      differences: [],
      onlyMuavin: [],
      onlyMizan: [],
      comparedAccounts: 0,
    };
  }

  const sumByAccount = (rows, isMizan) => {
    const map = new Map();
    for (const row of rows) {
      const key = compactAccountCode(row.hesapKodu);
      if (!key) continue;
      const cur = map.get(key) || {
        hesapKodu: row.hesapKodu,
        borc: 0,
        alacak: 0,
        bakiye: 0,
      };
      cur.borc = roundMoney(cur.borc + roundMoney(row.borc));
      cur.alacak = roundMoney(cur.alacak + roundMoney(row.alacak));
      if (isMizan) {
        const bak = Number(row.bakiye);
        if (Number.isFinite(bak)) cur.bakiye = roundMoney(bak);
        else cur.bakiye = roundMoney(cur.borc - cur.alacak);
      } else {
        cur.bakiye = roundMoney(cur.borc - cur.alacak);
      }
      map.set(key, cur);
    }
    return map;
  };

  const muavinMap = sumByAccount(muavinRows, false);
  const mizanMap = sumByAccount(mizanRows, true);
  const allKeys = new Set([...muavinMap.keys(), ...mizanMap.keys()]);
  const differences = [];
  const onlyMuavin = [];
  const onlyMizan = [];

  for (const key of allKeys) {
    const m = muavinMap.get(key);
    const z = mizanMap.get(key);
    if (m && !z) {
      onlyMuavin.push(m.hesapKodu);
      continue;
    }
    if (z && !m) {
      onlyMizan.push(z.hesapKodu);
      continue;
    }
    const borcFark = roundMoney(m.borc - z.borc);
    const alacakFark = roundMoney(m.alacak - z.alacak);
    const bakiyeFark = roundMoney(m.bakiye - z.bakiye);
    if (
      Math.abs(borcFark) > tolerance ||
      Math.abs(alacakFark) > tolerance ||
      Math.abs(bakiyeFark) > tolerance
    ) {
      differences.push({
        hesapKodu: m.hesapKodu,
        muavin: { borc: m.borc, alacak: m.alacak, bakiye: m.bakiye },
        mizan: { borc: z.borc, alacak: z.alacak, bakiye: z.bakiye },
        fark: { borc: borcFark, alacak: alacakFark, bakiye: bakiyeFark },
      });
    }
  }

  const matched =
    differences.length === 0 && onlyMuavin.length === 0 && onlyMizan.length === 0;

  return {
    status: matched ? "MATCHED" : "MISMATCH",
    code: matched ? "" : E_DEFTER_ISSUE_CODE.MIZAN_MUAVIN_MISMATCH,
    matched,
    message: matched
      ? "Muavin ve mizan hesap bazında mutabık."
      : "Muavin↔mizan farkı veya yalnız bir tarafta olan hesap var.",
    differences,
    onlyMuavin,
    onlyMizan,
    comparedAccounts: allKeys.size,
  };
}

function moneyKey(value) {
  return roundMoney(value).toFixed(2);
}

export const MUAVIN_YEVMIYE_DIFF_STATUS = {
  ONLY_MUAVIN: "ONLY_MUAVIN",
  ONLY_YEVMIYE: "ONLY_YEVMIYE",
  AMOUNT_DIFF: "AMOUNT_DIFF",
  DATE_DIFF: "DATE_DIFF",
  FIS_DIFF: "FIS_DIFF",
};

export const MUAVIN_YEVMIYE_DIFF_LABEL = {
  ONLY_MUAVIN: "Yalnız muavinde",
  ONLY_YEVMIYE: "Yalnız yevmiyede",
  AMOUNT_DIFF: "Tutar farklı",
  DATE_DIFF: "Tarih farklı",
  FIS_DIFF: "Fiş numarası farklı",
};

function muavinYevmiyeMatchKey(row = {}) {
  return [
    compact(row.fisNo),
    String(row.tarih || "").trim(),
    compactAccountCode(row.hesapKodu),
    moneyKey(row.borc),
    moneyKey(row.alacak),
  ].join("|");
}

/** Muavin↔yevmiye satır fingerprint (tarih|fiş|hesap|borç|alacak). */
export function buildMuavinYevmiyeFingerprint(row = {}) {
  return muavinYevmiyeMatchKey(row);
}

function pushMultiset(map, key, row) {
  const list = map.get(key) || [];
  list.push(row);
  map.set(key, list);
}

function takeMultiset(map, key) {
  const list = map.get(key);
  if (!list?.length) return null;
  const row = list.shift();
  if (!list.length) map.delete(key);
  else map.set(key, list);
  return row;
}

function flattenMultiset(map) {
  const rows = [];
  for (const list of map.values()) rows.push(...list);
  return rows;
}

function sideSnapshot(row = {}) {
  return {
    fisNo: row.fisNo || "",
    tarih: row.tarih || "",
    hesapKodu: row.hesapKodu || "",
    borc: roundMoney(row.borc),
    alacak: roundMoney(row.alacak),
  };
}

function buildMuavinYevmiyeDiff({
  status,
  muavin = null,
  yevmiye = null,
} = {}) {
  const primary = muavin || yevmiye || {};
  return {
    status,
    statusLabel: MUAVIN_YEVMIYE_DIFF_LABEL[status] || status,
    fisNo: primary.fisNo || muavin?.fisNo || yevmiye?.fisNo || "",
    tarih: primary.tarih || muavin?.tarih || yevmiye?.tarih || "",
    hesapKodu: primary.hesapKodu || muavin?.hesapKodu || yevmiye?.hesapKodu || "",
    muavin: muavin ? sideSnapshot(muavin) : null,
    yevmiye: yevmiye ? sideSnapshot(yevmiye) : null,
  };
}

function findSoftPeer(map, predicate) {
  for (const [key, list] of map.entries()) {
    if (!list?.length) continue;
    if (predicate(list[0], key)) return key;
  }
  return null;
}

/**
 * Controlled muavin↔yevmiye match on fis+tarih+hesap+amount (multiset).
 * Soft residual classes: amount/date/fis diffs; leftovers stay alone.
 */
export function reconcileMuavinYevmiye({
  muavinRows = [],
  yevmiyeRows = [],
  tolerance = BORC_ALACAK_TOLERANCE,
} = {}) {
  const hasMuavin = (muavinRows || []).length > 0;
  const hasYevmiye = (yevmiyeRows || []).length > 0;
  const empty = {
    status: "EVIDENCE_MISSING",
    matched: false,
    message: !hasMuavin && !hasYevmiye
      ? "Muavin ve yevmiye yüklenmedi; mutabakat yapılamadı."
      : !hasMuavin
        ? "Muavin yok; yevmiye ile eşleştirme yapılamadı."
        : "Yevmiye yok; muavin ile eşleştirme yapılamadı.",
    matchedCount: 0,
    denominator: Math.max(muavinRows?.length || 0, yevmiyeRows?.length || 0),
    onlyMuavin: [],
    onlyYevmiye: [],
    amountMismatches: [],
    differences: [],
    counts: {
      onlyMuavin: 0,
      onlyYevmiye: 0,
      amountDiff: 0,
      dateDiff: 0,
      fisDiff: 0,
      total: 0,
    },
    muavinMovements: muavinRows?.length || 0,
    yevmiyeMovements: yevmiyeRows?.length || 0,
    yevmiyeVouchers: 0,
  };
  if (!hasMuavin || !hasYevmiye) return empty;

  const yevmiyeVouchers = new Set(
    (yevmiyeRows || []).map((row) => compact(row.fisNo)).filter(Boolean)
  ).size;

  const muavinMap = new Map();
  for (const row of muavinRows) {
    if (!compactAccountCode(row.hesapKodu)) continue;
    pushMultiset(muavinMap, muavinYevmiyeMatchKey(row), row);
  }

  let matchedCount = 0;
  const residualYevmiye = [];
  for (const row of yevmiyeRows) {
    if (!compactAccountCode(row.hesapKodu)) continue;
    const taken = takeMultiset(muavinMap, muavinYevmiyeMatchKey(row));
    if (taken) {
      matchedCount += 1;
      continue;
    }
    residualYevmiye.push(row);
  }

  const residualMuavinMap = muavinMap;
  const residualYevmiyeMap = new Map();
  for (const row of residualYevmiye) {
    pushMultiset(residualYevmiyeMap, muavinYevmiyeMatchKey(row), row);
  }

  const differences = [];

  const softPairOnce = (status, predicate) => {
    for (const yRow of flattenMultiset(residualYevmiyeMap)) {
      const yKey = muavinYevmiyeMatchKey(yRow);
      if (!residualYevmiyeMap.get(yKey)?.length) continue;
      const softKey = findSoftPeer(residualMuavinMap, (m) => predicate(m, yRow));
      if (!softKey) continue;
      const mRow = takeMultiset(residualMuavinMap, softKey);
      const takenY = takeMultiset(residualYevmiyeMap, yKey);
      if (!mRow || !takenY) {
        if (mRow) pushMultiset(residualMuavinMap, softKey, mRow);
        if (takenY) pushMultiset(residualYevmiyeMap, yKey, takenY);
        continue;
      }
      if (status === MUAVIN_YEVMIYE_DIFF_STATUS.AMOUNT_DIFF) {
        const borcGap = Math.abs(roundMoney(mRow.borc) - roundMoney(takenY.borc));
        const alacakGap = Math.abs(roundMoney(mRow.alacak) - roundMoney(takenY.alacak));
        if (borcGap <= tolerance && alacakGap <= tolerance) {
          matchedCount += 1;
          return true;
        }
      }
      differences.push(
        buildMuavinYevmiyeDiff({
          status,
          muavin: mRow,
          yevmiye: takenY,
        })
      );
      return true;
    }
    return false;
  };

  while (
    softPairOnce(
      MUAVIN_YEVMIYE_DIFF_STATUS.AMOUNT_DIFF,
      (m, y) =>
        compact(m.fisNo) === compact(y.fisNo) &&
        String(m.tarih || "").trim() === String(y.tarih || "").trim() &&
        compactAccountCode(m.hesapKodu) === compactAccountCode(y.hesapKodu)
    )
  ) {
    /* consume amount soft pairs */
  }

  while (
    softPairOnce(
      MUAVIN_YEVMIYE_DIFF_STATUS.DATE_DIFF,
      (m, y) =>
        compact(m.fisNo) === compact(y.fisNo) &&
        compactAccountCode(m.hesapKodu) === compactAccountCode(y.hesapKodu) &&
        moneyKey(m.borc) === moneyKey(y.borc) &&
        moneyKey(m.alacak) === moneyKey(y.alacak)
    )
  ) {
    /* consume date soft pairs */
  }

  while (
    softPairOnce(
      MUAVIN_YEVMIYE_DIFF_STATUS.FIS_DIFF,
      (m, y) =>
        String(m.tarih || "").trim() === String(y.tarih || "").trim() &&
        compactAccountCode(m.hesapKodu) === compactAccountCode(y.hesapKodu) &&
        moneyKey(m.borc) === moneyKey(y.borc) &&
        moneyKey(m.alacak) === moneyKey(y.alacak)
    )
  ) {
    /* consume fis soft pairs */
  }

  const onlyMuavin = [];
  for (const row of flattenMultiset(residualMuavinMap)) {
    const diff = buildMuavinYevmiyeDiff({
      status: MUAVIN_YEVMIYE_DIFF_STATUS.ONLY_MUAVIN,
      muavin: row,
    });
    onlyMuavin.push(diff);
    differences.push(diff);
  }
  const onlyYevmiye = [];
  for (const row of flattenMultiset(residualYevmiyeMap)) {
    const diff = buildMuavinYevmiyeDiff({
      status: MUAVIN_YEVMIYE_DIFF_STATUS.ONLY_YEVMIYE,
      yevmiye: row,
    });
    onlyYevmiye.push(diff);
    differences.push(diff);
  }

  const amountMismatches = differences.filter(
    (d) => d.status === MUAVIN_YEVMIYE_DIFF_STATUS.AMOUNT_DIFF
  );
  const counts = {
    onlyMuavin: onlyMuavin.length,
    onlyYevmiye: onlyYevmiye.length,
    amountDiff: amountMismatches.length,
    dateDiff: differences.filter((d) => d.status === MUAVIN_YEVMIYE_DIFF_STATUS.DATE_DIFF)
      .length,
    fisDiff: differences.filter((d) => d.status === MUAVIN_YEVMIYE_DIFF_STATUS.FIS_DIFF)
      .length,
    total: differences.length,
  };

  const denominator = Math.max(muavinRows.length, yevmiyeRows.length);
  const matched = counts.total === 0;

  return {
    status: matched ? "MATCHED" : "MISMATCH",
    matched,
    message: matched
      ? `Tam eşleşti (${denominator}/${denominator})`
      : `${matchedCount}/${denominator} eşleşti`,
    matchedCount,
    denominator,
    onlyMuavin,
    onlyYevmiye,
    amountMismatches,
    differences,
    counts,
    muavinMovements: muavinRows.length,
    yevmiyeMovements: yevmiyeRows.length,
    yevmiyeVouchers,
  };
}

function emptyCounters() {
  return {
    parseInvocations: 0,
    analysisInvocations: 0,
    persistInvocations: 0,
  };
}

/**
 * One-click Genel Muhasebe control. Persist stays local-only (counters; no DB write).
 */
export function runGenelMuhasebeKontrol({
  companyId = "",
  period = "",
  muavinSheetRows = null,
  yevmiyeSheetRows = null,
  mizanSheetRows = null,
  accountPlanAccounts = null,
  accountPlanStatus = "unknown",
  spies = null,
} = {}) {
  const counters = spies || emptyCounters();
  const timing = {
    parseMs: 0,
    groupingMs: 0,
    counterpartMs: 0,
    accountingMs: 0,
    reconcileMs: 0,
    totalMs: 0,
  };
  const tTotal0 = performance.now();
  const parsed = { muavin: [], yevmiye: [], mizan: [], classes: {} };

  const ingest = (sheetRows, preferredHint) => {
    if (!sheetRows) return;
    counters.parseInvocations += 1;
    const t0 = performance.now();
    const contentClass = classifyLedgerDocumentType(sheetRows);
    const documentClass = refineDocumentClass(contentClass, preferredHint, sheetRows);
    const { rows } = parseLedgerByDocumentClass(sheetRows, documentClass);
    timing.parseMs += performance.now() - t0;
    parsed.classes[documentClass] = (parsed.classes[documentClass] || 0) + 1;
    if (documentClass === GENEL_MUHASEBE_DOC_CLASS.MIZAN) parsed.mizan.push(...rows);
    else if (documentClass === GENEL_MUHASEBE_DOC_CLASS.MUAVIN) parsed.muavin.push(...rows);
    else parsed.yevmiye.push(...rows);
  };

  // Prefer content class even when UI slots files into buckets.
  if (muavinSheetRows) ingest(muavinSheetRows, GENEL_MUHASEBE_DOC_CLASS.MUAVIN);
  if (yevmiyeSheetRows) {
    ingest(yevmiyeSheetRows, GENEL_MUHASEBE_DOC_CLASS.YEVMIYE);
    parsed.yevmiye = parsed.yevmiye.filter(isValidYevmiyeMovementRow);
    if (!parsed.yevmiye.length) {
      const layout = detectYevmiyeLayout(yevmiyeSheetRows);
      if (layout === YEVMIYE_LAYOUT.UNKNOWN) {
        throw Object.assign(new Error("Desteklenmeyen yevmiye düzeni."), {
          code: "UNSUPPORTED_YEVMIYE_LAYOUT",
        });
      }
      throw Object.assign(new Error("Yevmiye dosyasından hareket okunamadı."), {
        code: "EMPTY_YEVMIYE_PARSE",
      });
    }
  }
  if (mizanSheetRows) ingest(mizanSheetRows, GENEL_MUHASEBE_DOC_CLASS.MIZAN);

  // Stamp period for counterpart group isolation.
  const stamp = (rows) =>
    rows.map((row) => ({
      ...row,
      period: period || row.period || "",
      companyId: companyId || row.companyId || "",
    }));

  parsed.muavin = stamp(parsed.muavin);
  parsed.yevmiye = stamp(parsed.yevmiye);
  parsed.mizan = stamp(parsed.mizan);

  const planLoaded = Array.isArray(accountPlanAccounts);
  const planCodeCount = planLoaded
    ? accountPlanAccounts.filter((account) => accountCodeFromPlanRow(account)).length
    : 0;
  const planEmpty = planLoaded && planCodeCount === 0;
  // PRESENT only when clone-safe payload actually carries at least one plan code.
  const planEvidencePresent =
    planLoaded && !planEmpty && accountPlanStatus !== "missing";
  const accountPlanCodes = planEvidencePresent
    ? buildAccountPlanCodeSet(accountPlanAccounts)
    : null;

  counters.analysisInvocations += 1;
  const tAcc0 = performance.now();
  const yevmiyeEvidencePresent = parsed.yevmiye.length > 0;
  const pipeline = runEDefterKontrolPipeline({
    muavinRows: yevmiyeEvidencePresent ? [] : parsed.muavin,
    yevmiyeRows: yevmiyeEvidencePresent ? parsed.yevmiye : [],
    mizanRows: parsed.mizan,
    companyId,
    period,
    accountPlanCodes,
    yevmiyeEvidencePresent,
    cumulativePeriod: true,
  });
  timing.accountingMs += performance.now() - tAcc0;

  const tRec0 = performance.now();
  const reconcile = reconcileMizanMuavin({
    muavinRows: parsed.muavin,
    mizanRows: parsed.mizan,
  });
  const muavinYevmiye = reconcileMuavinYevmiye({
    muavinRows: parsed.muavin,
    yevmiyeRows: parsed.yevmiye,
  });
  timing.reconcileMs += performance.now() - tRec0;

  const ledgerRows = pipeline.rows.filter(
    (row) =>
      !isSyntheticSystemFindingRow(row) &&
      (row.kaynak === E_DEFTER_KAYNAK.MUAVIN ||
        row.kaynak === E_DEFTER_KAYNAK.YEVMIYE ||
        row.kaynak === E_DEFTER_KAYNAK.YEVMIYE_XML)
  );
  const systemFindingRows = pipeline.rows.filter((row) => isSyntheticSystemFindingRow(row));

  // Reuse pipeline counterpart outcomes — do not re-run resolver (idempotent / perf).
  let resolved = 0;
  let multi = 0;
  let review = 0;
  for (const row of ledgerRows) {
    const codes = new Set((row.issueDetails || []).map((i) => i.code));
    if (codes.has(E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART)) multi += 1;
    else if (
      codes.has(E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART) ||
      codes.has(E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE) ||
      codes.has(E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW) ||
      codes.has(E_DEFTER_ISSUE_CODE.COUNTERPART_SELF) ||
      codes.has(E_DEFTER_ISSUE_CODE.COUNTERPART_CONFLICT)
    ) {
      review += 1;
    } else if (row.counterAccountCode || row.karsiHesapKodu) {
      resolved += 1;
    }
  }
  timing.counterpartMs = 0;
  timing.groupingMs = 0;

  const extraFindings = [];
  if (!planEvidencePresent) {
    extraFindings.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.PLAN_EVIDENCE_MISSING,
        message: "Hesap planı yüklenemedi; ‘hesap planda yok’ kararı verilmedi.",
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 8,
      })
    );
  }
  if (reconcile.status === "EVIDENCE_MISSING") {
    const mizanMissingOnly = parsed.muavin.length > 0 && parsed.mizan.length === 0;
    extraFindings.push(
      createEDefterIssue({
        code: reconcile.code,
        message: mizanMissingOnly
          ? "Mizan yüklenmedi"
          : reconcile.message,
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 8,
      })
    );
  } else if (reconcile.status === "MISMATCH") {
    extraFindings.push(
      createEDefterIssue({
        code: reconcile.code,
        message: `${reconcile.message} (fark=${reconcile.differences.length}, yalnızMuavin=${reconcile.onlyMuavin.length}, yalnızMizan=${reconcile.onlyMizan.length})`,
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 22,
      })
    );
  }

  if (muavinYevmiye.status === "MISMATCH") {
    if (!muavinYevmiye.differences?.length) {
      throw Object.assign(
        new Error("Muavin↔yevmiye farkı tespit edildi fakat ayrıntı üretilemedi."),
        { code: E_DEFTER_ISSUE_CODE.MUAVIN_YEVMIYE_RECONCILE_FAILED }
      );
    }
    extraFindings.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.MUAVIN_YEVMIYE_MISMATCH,
        message: `${muavinYevmiye.message} (yalnız muavin=${muavinYevmiye.counts.onlyMuavin}, yalnız yevmiye=${muavinYevmiye.counts.onlyYevmiye}, tutar=${muavinYevmiye.counts.amountDiff}, tarih=${muavinYevmiye.counts.dateDiff}, fiş=${muavinYevmiye.counts.fisDiff})`,
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 22,
      })
    );
    for (const diff of muavinYevmiye.differences) {
      const m = diff.muavin;
      const y = diff.yevmiye;
      const moneyPart = [
        m ? `Muavin ${roundMoney(m.borc)}/${roundMoney(m.alacak)}` : null,
        y ? `Yevmiye ${roundMoney(y.borc)}/${roundMoney(y.alacak)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      extraFindings.push({
        ...createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.MUAVIN_YEVMIYE_MISMATCH,
          message: `${diff.statusLabel}${moneyPart ? ` — ${moneyPart}` : ""}`,
          severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
          group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
          riskScore: 8,
        }),
        fisNo: diff.fisNo || "",
        tarih: diff.tarih || "",
        hesapKodu: diff.hesapKodu || "",
        statusLabel: diff.statusLabel,
        muavin: m,
        yevmiye: y,
      });
    }
  }

  // Vadeli↔vadeli virman heuristic (review only; no invent).
  for (const row of ledgerRows) {
    const code = String(row.hesapKodu || "");
    const counter = String(row.counterAccountCode || row.karsiHesapKodu || "");
    const isVadeli = (c) => /^(102\.|111\.|112\.|121\.|3)/.test(c) && /vadeli|mevduat/i.test(`${row.hesapAdi || ""} ${row.aciklama || ""}`);
    if (counter && isVadeli(code) && isVadeli(counter)) {
      extraFindings.push(
        createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW,
          message: "Vadeli hesaplar arasında virman benzeri karşıt — inceleme gerekli.",
          severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
          group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
          riskScore: 10,
        })
      );
      break;
    }
  }

  const issueFlat = pipeline.rows.flatMap((row) => row.issueDetails || []);
  const countCode = (code) => issueFlat.filter((i) => i.code === code).length;

  const totals = ledgerRows.reduce(
    (acc, row) => {
      acc.borc = roundMoney(acc.borc + roundMoney(row.borc));
      acc.alacak = roundMoney(acc.alacak + roundMoney(row.alacak));
      return acc;
    },
    { borc: 0, alacak: 0 }
  );

  const fisKeys = new Set(
    ledgerRows.map((row) => compact(row.fisNo)).filter(Boolean)
  );
  const unbalanced = new Set();
  const byFis = new Map();
  for (const row of ledgerRows) {
    const key = compact(row.fisNo);
    if (!key) continue;
    const cur = byFis.get(key) || { borc: 0, alacak: 0 };
    cur.borc = roundMoney(cur.borc + roundMoney(row.borc));
    cur.alacak = roundMoney(cur.alacak + roundMoney(row.alacak));
    byFis.set(key, cur);
  }
  for (const [key, bal] of byFis.entries()) {
    if (Math.abs(bal.borc - bal.alacak) > BORC_ALACAK_TOLERANCE) unbalanced.add(key);
  }

  let overallSonuc = pipeline.overallSonuc || E_DEFTER_SONUC_SEVIYE.UYGUN;
  const findingsCatalog = buildGenelMuhasebeFindingsCatalog({
    rows: pipeline.rows,
    findingExtras: extraFindings,
  });
  const findingsSummary = summarizeGenelMuhasebeFindingsCatalog(findingsCatalog);
  overallSonuc = findingsSummary.overallSonuc;

  // Local-only: never persist here.
  counters.persistInvocations = 0;
  timing.totalMs = performance.now() - tTotal0;

  const mizanMuavinSummary = {
    ...reconcile,
    userLabel:
      reconcile.status === "EVIDENCE_MISSING" &&
      parsed.muavin.length > 0 &&
      parsed.mizan.length === 0
        ? "Mizan yüklenmedi"
        : reconcile.status === "EVIDENCE_MISSING"
          ? reconcile.message
          : reconcile.status === "MATCHED" || reconcile.matched
            ? "Mutabık"
            : reconcile.status === "MISMATCH"
              ? "Fark var"
              : reconcile.status || "—",
  };
  const yevmiyeFisKeys = new Set(
    parsed.yevmiye.map((row) => compact(row.fisNo)).filter(Boolean)
  );
  const muavinYevmiyeSummary = {
    ...muavinYevmiye,
    userLabel:
      muavinYevmiye.status === "EVIDENCE_MISSING"
        ? "Karşılaştırılamadı"
        : muavinYevmiye.matched
          ? `Tam eşleşti (${muavinYevmiye.denominator}/${muavinYevmiye.denominator})`
          : `${muavinYevmiye.matchedCount}/${muavinYevmiye.denominator} eşleşti`,
  };

  return {
    mode: "local-control",
    companyId,
    period,
    rows: pipeline.rows,
    findingExtras: extraFindings,
    findingsCatalog,
    findingsSummary,
    documentClasses: parsed.classes,
    parsedCounts: {
      muavin: parsed.muavin.length,
      yevmiye: parsed.yevmiye.length,
      mizan: parsed.mizan.length,
    },
    timing: {
      parseMs: Math.round(timing.parseMs),
      groupingMs: Math.round(timing.groupingMs),
      counterpartMs: Math.round(timing.counterpartMs),
      accountingMs: Math.round(timing.accountingMs),
      reconcileMs: Math.round(timing.reconcileMs),
      totalMs: Math.round(timing.totalMs),
    },
    summary: {
      // Movement totals only — synthetic system findings excluded from hareket/fiş/BA.
      toplamSatir: ledgerRows.length,
      hareketSatir: ledgerRows.length,
      sistemBilgisi: systemFindingRows.length,
      toplamFis: fisKeys.size,
      dengeliFis: Math.max(0, fisKeys.size - unbalanced.size),
      dengesizFis: unbalanced.size,
      kesinKarsit: resolved,
      cokluKarsit: multi,
      // BİLGİ extras (mizan/plan) must not inflate inceleme counter.
      incelemeGerekli: findingsSummary.incelemeGerekli,
      hesapPlandaYok: countCode(E_DEFTER_ISSUE_CODE.ACCOUNT_NOT_IN_PLAN),
      donemDisi: countCode(E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD),
      mukerrer: countCode(E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY),
      borcToplam: totals.borc,
      alacakToplam: totals.alacak,
      borcAlacakFark: roundMoney(totals.borc - totals.alacak),
      mizanMuavin: mizanMuavinSummary,
      muavinYevmiye: muavinYevmiyeSummary,
      muavinHareketSatir: parsed.muavin.length,
      yevmiyeHareketSatir: parsed.yevmiye.length,
      yevmiyeFis: yevmiyeFisKeys.size,
      yevmiyeEvidence: yevmiyeEvidencePresent ? "PRESENT" : "MISSING",
      planEvidence: planEvidencePresent ? "PRESENT" : "MISSING",
      planStatus: planEvidencePresent ? "loaded" : "missing",
      overallSonuc,
      edefterUygun:
        overallSonuc === E_DEFTER_SONUC_SEVIYE.UYGUN ||
        overallSonuc === E_DEFTER_SONUC_SEVIYE.BILGI,
      localOnly: true,
    },
    counters: { ...counters },
    pipelineSummary: pipeline.summary,
  };
}

/** Idempotent gate helper for UI double-click protection. */
export function createGenelMuhasebeAnalyzeGate() {
  let locked = false;
  let generation = 0;
  return {
    begin() {
      if (locked) return { accepted: false, generation };
      locked = true;
      generation += 1;
      return { accepted: true, generation };
    },
    end() {
      locked = false;
    },
    get generation() {
      return generation;
    },
    get locked() {
      return locked;
    },
  };
}
