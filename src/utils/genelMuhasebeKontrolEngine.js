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
  parseMizanSheet,
  parseMuavinSheet,
  parseYevmiyeSheet,
  runEDefterKontrolPipeline,
} from "@/src/utils/eDefterKontrolEngine";
import { normalizeParserText } from "@/src/utils/textNormalize";

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
      if (/^\d{3,}([./]\d{1,4}){0,5}$/.test(text)) codes.add(compact(text));
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

export function buildAccountPlanCodeSet(accounts = []) {
  const set = new Set();
  for (const account of accounts || []) {
    const code = String(account.account_code || account.hesapKodu || account.code || "").trim();
    if (!code) continue;
    set.add(code);
    set.add(compact(code));
    const short = code.split(".")[0];
    if (short) set.add(short);
  }
  return set;
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
      const key = compact(row.hesapKodu);
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
  if (yevmiyeSheetRows) ingest(yevmiyeSheetRows, GENEL_MUHASEBE_DOC_CLASS.YEVMIYE);
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
  const planEmpty = planLoaded && accountPlanAccounts.length === 0;
  const accountPlanCodes =
    planLoaded && !planEmpty ? buildAccountPlanCodeSet(accountPlanAccounts) : null;

  counters.analysisInvocations += 1;
  const tAcc0 = performance.now();
  const pipeline = runEDefterKontrolPipeline({
    muavinRows: parsed.muavin,
    yevmiyeRows: parsed.yevmiye,
    mizanRows: parsed.mizan,
    companyId,
    period,
    accountPlanCodes,
  });
  timing.accountingMs += performance.now() - tAcc0;

  // Only true MUAVIN vs MIZAN — never treat yevmiye as muavin substitute for "mutabık".
  const tRec0 = performance.now();
  const reconcile = reconcileMizanMuavin({
    muavinRows: parsed.muavin,
    mizanRows: parsed.mizan,
  });
  timing.reconcileMs += performance.now() - tRec0;

  const ledgerRows = pipeline.rows.filter(
    (row) =>
      row.kaynak === E_DEFTER_KAYNAK.MUAVIN ||
      row.kaynak === E_DEFTER_KAYNAK.YEVMIYE ||
      row.kaynak === E_DEFTER_KAYNAK.YEVMIYE_XML
  );

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
  if (!planLoaded || accountPlanStatus === "missing" || planEmpty) {
    extraFindings.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.PLAN_EVIDENCE_MISSING,
        message: "Aktif hesap planı yok veya yüklenemedi; ‘hesap planda yok’ kararı verilmedi.",
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 8,
      })
    );
  }
  if (reconcile.status === "EVIDENCE_MISSING") {
    extraFindings.push(
      createEDefterIssue({
        code: reconcile.code,
        message: reconcile.message,
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
  if (extraFindings.some((f) => f.severity === E_DEFTER_ISSUE_SEVERITY.UYARI)) {
    if (overallSonuc === E_DEFTER_SONUC_SEVIYE.UYGUN || overallSonuc === E_DEFTER_SONUC_SEVIYE.BILGI) {
      overallSonuc = E_DEFTER_SONUC_SEVIYE.UYARI;
    }
  } else if (extraFindings.length && overallSonuc === E_DEFTER_SONUC_SEVIYE.UYGUN) {
    overallSonuc = E_DEFTER_SONUC_SEVIYE.BILGI;
  }

  // Local-only: never persist here.
  counters.persistInvocations = 0;
  timing.totalMs = performance.now() - tTotal0;

  return {
    mode: "local-control",
    companyId,
    period,
    rows: pipeline.rows,
    findingExtras: extraFindings,
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
      toplamSatir: ledgerRows.length,
      toplamFis: fisKeys.size,
      dengeliFis: Math.max(0, fisKeys.size - unbalanced.size),
      dengesizFis: unbalanced.size,
      kesinKarsit: resolved,
      cokluKarsit: multi,
      incelemeGerekli: review + extraFindings.length,
      hesapPlandaYok: countCode(E_DEFTER_ISSUE_CODE.ACCOUNT_NOT_IN_PLAN),
      donemDisi: countCode(E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD),
      mukerrer: countCode(E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY),
      borcToplam: totals.borc,
      alacakToplam: totals.alacak,
      borcAlacakFark: roundMoney(totals.borc - totals.alacak),
      mizanMuavin: reconcile,
      planEvidence:
        !planLoaded || planEmpty || accountPlanStatus === "missing"
          ? "MISSING"
          : "LOADED",
      overallSonuc,
      edefterUygun: overallSonuc === E_DEFTER_SONUC_SEVIYE.UYGUN || overallSonuc === E_DEFTER_SONUC_SEVIYE.BILGI,
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
