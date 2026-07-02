import { extractSeriesPrefix, MEMORY_MATCH_LABEL } from "@/src/utils/previewRowEdit";
import { formatParserDate } from "@/src/utils/bankMovementMapper";
import {
  appendControlNote,
  buildGroupedCariDescription,
  groupTebHavaleMovements,
  logTebHavaleGroupingReport,
  TEB_MASRAF_ACCOUNT,
  TEB_MASRAF_DESCRIPTION,
  TEB_UNMATCHED_MASRAF_NOTE,
} from "@/src/utils/tebHavaleGrouping";
import {
  applyMatchResultToRow,
  buildElektrawebCompanyMappings,
  buildElektrawebCombinedSearchText,
  logElektrawebAccountMatchReport,
  matchAccountCode,
} from "@/src/utils/elektrawebAccountMatcher";
import { normalizeAccountPlanForMatching } from "@/src/utils/companyCenter";
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";

export const STANDARD_LUCA_ROW_FORMAT = "standard-luca-row-v1";

export const KAYNAK_TIPI = {
  ELEKTRAWEB: "ELEKTRAWEB",
  BANKA: "BANKA",
};

export const LUCA_EXPORT_HEADERS = [
  "Fiş No",
  "Fiş Tarihi",
  "Fiş Açıklama",
  "Hesap Kodu",
  "Evrak No",
  "Evrak Tarihi",
  "Detay Açıklama",
  "Borç",
  "Alacak",
  "Miktar",
  "Belge Türü",
  "Para Birimi",
  "Kur",
  "Döviz Tutar",
];

function compactKey(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ş", "S")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeTr(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ş", "S")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C");
}

export function getRowValue(row, ...keys) {
  if (!row || typeof row !== "object") return "";

  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }

  const wantedKeys = keys.map(compactKey);

  for (const [rawKey, value] of Object.entries(row)) {
    if (value === undefined || value === null || String(value).trim() === "") continue;

    if (wantedKeys.includes(compactKey(rawKey))) {
      return value;
    }
  }

  return "";
}

function excelSerialToDate(serial) {
  const utcDays = Math.floor(Number(serial) - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function excelDateToText(value) {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = String(value.getDate()).padStart(2, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const year = value.getFullYear();
    return `${day}.${month}.${year}`;
  }

  if (typeof value === "number") {
    const date = excelSerialToDate(value);
    if (!date) return String(value);

    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const year = date.getUTCFullYear();
    return `${day}.${month}.${year}`;
  }

  return String(value).trim();
}

function parseAmount(value) {
  if (value === "" || value === null || value === undefined) {
    return 0;
  }

  return parseMoneyTR(value);
}

export { parseMoneyTR };

export function parseStandardLucaDate(value) {
  return parseDateTR(value);
}

export function ensureStandardLucaRowIds(rows = []) {
  return rows.map((row, index) => ({
    ...row,
    id: row.id ?? `sl-${index + 1}`,
  }));
}

export function createEmptyStandardLucaRow(context = {}) {
  const nextIndex = Number(context.nextIndex || 1);

  return finalizeStandardLucaRow({
    id: `manual-${Date.now()}-${nextIndex}`,
    firmaId: context.firmaId || "",
    kaynakTipi: context.kaynakTipi || KAYNAK_TIPI.BANKA,
    kaynakAdi: context.kaynakAdi || "Manuel",
    fisNo: context.fisNo ?? nextIndex,
    fisTarihi: context.fisTarihi || "",
    fisAciklama: "",
    belgeTuru: context.belgeTuru || "DK",
    hesapKodu: "",
    hesapAdi: "",
    karsiHesapKodu: "",
    detayAciklama: "",
    borc: "",
    alacak: "",
    manuallyEdited: true,
  });
}

export function sortStandardLucaRows(rows = []) {
  return [...rows].sort((left, right) => {
    const leftDate = parseStandardLucaDate(left.fisTarihi);
    const rightDate = parseStandardLucaDate(right.fisTarihi);

    if (leftDate && rightDate && leftDate.getTime() !== rightDate.getTime()) {
      return leftDate.getTime() - rightDate.getTime();
    }

    if (leftDate && !rightDate) return -1;
    if (!leftDate && rightDate) return 1;

    const leftFisNo = Number(left.fisNo);
    const rightFisNo = Number(right.fisNo);

    if (!Number.isNaN(leftFisNo) && !Number.isNaN(rightFisNo)) {
      return leftFisNo - rightFisNo;
    }

    return String(left.fisNo || "").localeCompare(
      String(right.fisNo || ""),
      "tr",
      { numeric: true }
    );
  });
}

function resolveElektrawebBelgeTuruHeuristic(text) {
  const normalized = normalizeTr(text);
  if (!normalized) return "";

  const baslar = (prefix) => new RegExp(`(^|\\s)${prefix}`).test(normalized);

  if (baslar("GIB") || baslar("MDA")) return "EA";
  if (baslar("MRT") || baslar("MR1") || baslar("MDF")) return "EF";
  if (normalized.includes("NOTER")) return "NM";
  if (
    normalized.includes("SMM") ||
    normalized.includes("SERBEST MESLEK") ||
    normalized.includes("YUSUF OZLU") ||
    normalized.includes("BATUHAN BULUT")
  ) {
    return "SMM";
  }
  if (normalized.includes("FATURA")) return "EF";
  if (normalized.includes("FT")) return "FT";

  return "";
}

export function resolveElektrawebBelgeTuru({
  detayAciklama = "",
  evrakNo = "",
  belgeNo = "",
  explicit = "",
  documentSeriesRules = [],
}) {
  const fromExplicit = String(explicit || "").trim().toUpperCase();
  if (fromExplicit) return fromExplicit;

  const text = `${detayAciklama} ${evrakNo} ${belgeNo}`.trim();
  const matchedPrefix = extractSeriesPrefix(text, documentSeriesRules);

  if (matchedPrefix) {
    const rule = (documentSeriesRules || []).find(
      (item) =>
        normalizeTr(item.prefix) === normalizeTr(matchedPrefix) ||
        normalizeTr(text).includes(normalizeTr(item.prefix))
    );

    if (rule?.documentType) {
      return String(rule.documentType).trim().toUpperCase();
    }
  }

  return resolveElektrawebBelgeTuruHeuristic(text);
}

export function finalizeStandardLucaRow(row) {
  const detayAciklama = String(
    row.detayAciklama || row.aciklama || ""
  ).trim();
  const fisAciklama = String(row.fisAciklama || "").trim() || detayAciklama;
  const aciklama = String(row.aciklama || detayAciklama || fisAciklama).trim();
  const cariUnvan = String(row.cariUnvan || "").trim();
  const belgeAciklama = String(row.belgeAciklama || fisAciklama || "").trim();

  let belgeTuru = String(row.belgeTuru || "").trim().toUpperCase();

  if (!belgeTuru && row.kaynakTipi === KAYNAK_TIPI.BANKA) {
    belgeTuru = "DK";
  }

  const hesapKodu = String(row.hesapKodu || "").trim();
  const hesapAdi = String(row.hesapAdi || "").trim();
  const karsiHesapKodu = String(row.karsiHesapKodu || row.karsiHesap || "").trim();
  let riskDurumu = String(row.riskDurumu || "").trim();

  if (!hesapKodu) {
    riskDurumu = riskDurumu || "HESAP_EKSIK";
  }

  return {
    firmaId: row.firmaId || "",
    kaynakTipi: row.kaynakTipi || "",
    kaynakAdi: row.kaynakAdi || "",
    fisNo: row.fisNo ?? "",
    fisTarihi: formatDateTR(row.fisTarihi),
    fisAciklama,
    belgeTuru,
    belgeNo: String(row.belgeNo || "").trim(),
    hesapKodu,
    hesapAdi,
    karsiHesapKodu,
    evrakNo: String(row.evrakNo || "").trim(),
    evrakTarihi: formatDateTR(row.evrakTarihi || row.fisTarihi),
    detayAciklama: detayAciklama || fisAciklama,
    aciklama,
    cariUnvan,
    belgeAciklama,
    borc: row.borc === "" || row.borc === null || row.borc === undefined ? "" : parseAmount(row.borc),
    alacak:
      row.alacak === "" || row.alacak === null || row.alacak === undefined
        ? ""
        : parseAmount(row.alacak),
    riskDurumu,
    kontrolNotu: String(row.kontrolNotu || "").trim(),
    hafizaEslesme: Boolean(row.hafizaEslesme),
    manuallyEdited: Boolean(row.manuallyEdited),
    ...(row.hafizaGuvenSkoru !== undefined && row.hafizaGuvenSkoru !== null
      ? { hafizaGuvenSkoru: Number(row.hafizaGuvenSkoru) }
      : {}),
    ...(row.accountMemoryAutoFilled
      ? { accountMemoryAutoFilled: true }
      : {}),
    ...(row.accountMemoryId ? { accountMemoryId: row.accountMemoryId } : {}),
    ...(row.matchedMemoryId ? { matchedMemoryId: row.matchedMemoryId } : {}),
    ...(row.id ? { id: row.id } : {}),
    ...(row._movementId ? { _movementId: row._movementId } : {}),
  };
}

export function normalizeElektrawebRawToStandardLucaRow(rawRow, context = {}) {
  const {
    firmaId = "",
    kaynakAdi = "ELEKTRAWEB",
    documentSeriesRules = [],
    index = 0,
    kontrolNotu = "",
    riskDurumu = "",
    hafizaEslesme = false,
  } = context;

  const fisNo = String(
    getRowValue(rawRow, "Fiş Numarası", "Fiş No", "Fis No", "Fis Numarasi") || ""
  ).trim();
  const fisTarihi = getRowValue(rawRow, "Fiş Tarihi", "Fis Tarihi", "Tarih");
  const detayAciklama = String(
    getRowValue(rawRow, "Açıklama", "Detay Notları", "Detay Açıklama", "Aciklama") ||
      ""
  ).trim();
  const fisAciklama = String(
    getRowValue(rawRow, "Fiş Açıklama", "Fis Aciklama") || detayAciklama
  ).trim();
  const cariUnvan = String(
    getRowValue(
      rawRow,
      "Cari Unvan",
      "Cari Ünvan",
      "CariUnvan",
      "Unvan",
      "Karşı Hesap"
    ) || ""
  ).trim();
  const belgeAciklama = String(
    getRowValue(
      rawRow,
      "Belge Açıklama",
      "Belge Aciklama",
      "BelgeAciklama",
      "Fiş Açıklama",
      "Fis Aciklama"
    ) || fisAciklama
  ).trim();
  const hesapKodu = String(
    getRowValue(
      rawRow,
      "Hesap Kodu",
      "Hesap",
      "HesapKodu",
      "kod",
      "Kod",
      "accountCode",
      "AccountCode"
    ) || ""
  ).trim();
  const evrakNo = String(
    getRowValue(rawRow, "Evrak No", "EvrakNo", "Belge No", "Fatura No") || ""
  ).trim();
  const evrakTarihi = getRowValue(rawRow, "Evrak Tarihi", "EvrakTarihi");
  const belgeNo = String(getRowValue(rawRow, "Belge No", "BelgeNo") || "").trim();
  const belgeTuru = resolveElektrawebBelgeTuru({
    detayAciklama,
    evrakNo,
    belgeNo,
    explicit: getRowValue(rawRow, "Belge Tipi", "Belge Türü", "BelgeTuru", "Belge Turu"),
    documentSeriesRules,
  });
  const borc = parseAmount(
    getRowValue(rawRow, "Borç", "Borc", "Toplam Borç", "Toplam Borc")
  );
  const alacak = parseAmount(
    getRowValue(rawRow, "Alacak", "Toplam Alacak")
  );

  return finalizeStandardLucaRow({
    id: index + 1,
    firmaId,
    kaynakTipi: KAYNAK_TIPI.ELEKTRAWEB,
    kaynakAdi,
    fisNo,
    fisTarihi,
    fisAciklama,
    belgeTuru,
    belgeNo,
    hesapKodu,
    evrakNo,
    evrakTarihi,
    detayAciklama,
    aciklama: detayAciklama || fisAciklama,
    cariUnvan,
    belgeAciklama,
    borc,
    alacak,
    riskDurumu,
    kontrolNotu,
    hafizaEslesme,
  });
}

export function enrichElektrawebStandardLucaRow(row, context = {}) {
  const documentSeriesRules = context.documentSeriesRules || [];
  const belgeTuru = resolveElektrawebBelgeTuru({
    detayAciklama: row.detayAciklama,
    evrakNo: row.evrakNo,
    belgeNo: row.belgeNo,
    explicit: row.belgeTuru,
    documentSeriesRules,
  });

  const baseRow = finalizeStandardLucaRow({
    ...row,
    firmaId: context.firmaId || row.firmaId || "",
    kaynakTipi: KAYNAK_TIPI.ELEKTRAWEB,
    kaynakAdi: context.kaynakAdi || row.kaynakAdi || "ELEKTRAWEB",
    belgeTuru,
    kontrolNotu: row.kontrolNotu || row.risk || "",
    riskDurumu:
      row.riskDurumu ||
      (row.riskler?.includes("Hesap kodu boş") ? "HESAP_EKSIK" : ""),
  });

  const accountPlan = normalizeAccountPlanForMatching(
    context.selectedCompanyAccountPlan ||
      context.normalizedAccountPlan ||
      context.accountPlan ||
      context.companyPlans ||
      []
  );

  if (!accountPlan.length) {
    return {
      ...baseRow,
      riskPuani: row.riskPuani,
      riskler: row.riskler || [],
      risk: row.risk,
      durum: row.durum,
      riskSeviyesi: row.riskSeviyesi,
    };
  }

  const companyMappings =
    context.companyMappings ||
    buildElektrawebCompanyMappings({
      documentSeriesRules,
      accountingRules: context.accountingRules,
      employees: context.employees,
      kuralMotoruRules: context.kuralMotoruRules,
      companyId: context.companyId || context.firmaId,
    });

  const match = matchAccountCode(
    baseRow,
    accountPlan,
    context.learningMemory || [],
    companyMappings
  );

  if (typeof context.collectDebug === "function") {
    context.collectDebug(match.debug);
  }

  const matched = applyMatchResultToRow(baseRow, match);
  matched.hesapKodu = match.hesapKodu;

  const finalized = finalizeStandardLucaRow(matched);

  return {
    ...finalized,
    eslesmeYontemi: matched.eslesmeYontemi || "",
    hesapEslesmeNotlari: matched.hesapEslesmeNotlari || [],
    riskPuani: row.riskPuani ?? finalized.riskPuani,
    riskler: row.riskler || finalized.riskler || [],
    risk: row.risk || finalized.risk,
    durum: row.durum || finalized.durum,
    riskSeviyesi: row.riskSeviyesi || finalized.riskSeviyesi,
  };
}

export function logElektrawebPreviewDiagnostics(standardRows = [], context = {}) {
  const sample = standardRows.slice(0, 10);

  console.log("[elektraweb-debug] standardRows.slice(0, 10)", sample);

  sample.forEach((row, index) => {
    const fields = {
      fisAciklama: row.fisAciklama ?? null,
      detayAciklama: row.detayAciklama ?? null,
      aciklama: row.aciklama ?? null,
      cariUnvan: row.cariUnvan ?? null,
      hesapKodu: row.hesapKodu ?? null,
    };

    console.log(`[elektraweb-debug] row-${index + 1} fields`, fields);
    console.log(`[elektraweb-debug] row-${index + 1} field-check`, {
      hasFisAciklama: Boolean(fields.fisAciklama),
      hasDetayAciklama: Boolean(fields.detayAciklama),
      hasAciklama: Boolean(fields.aciklama),
      hasCariUnvan: Boolean(fields.cariUnvan),
      hasHesapKodu: Boolean(fields.hesapKodu),
    });
  });

  if (context.afterMatching) {
    const matchedCount = standardRows.filter((row) =>
      String(row.hesapKodu || "").trim()
    ).length;
    console.log("[elektraweb-debug] hesapKodu dolu satir", matchedCount, "/", standardRows.length);
  }
}

export function buildElektrawebPreviewRows(rows = [], context = {}) {
  const debugRows = [];
  const accountPlan = normalizeAccountPlanForMatching(
    context.selectedCompanyAccountPlan ||
      context.normalizedAccountPlan ||
      context.accountPlan ||
      context.companyPlans ||
      []
  );

  const enrichedRows = sortStandardLucaRows(rows).map((row) =>
    enrichElektrawebStandardLucaRow(row, {
      ...context,
      selectedCompanyAccountPlan: accountPlan,
      normalizedAccountPlan: accountPlan,
      collectDebug: (debug) => debugRows.push(debug),
    })
  );

  logElektrawebAccountMatchReport(debugRows, accountPlan.length);

  return enrichedRows;
}

function buildBankLucaLine({
  movement,
  fisNo,
  context,
  hesapKodu,
  borc,
  alacak,
  fisAciklama,
  detayAciklama,
  belgeTuru,
}) {
  const tarih = formatParserDate(movement.date);

  return finalizeStandardLucaRow({
    id: `${movement.id}-${hesapKodu}-${borc}-${alacak}`,
    firmaId: context.firmaId || "",
    kaynakTipi: KAYNAK_TIPI.BANKA,
    kaynakAdi: context.kaynakAdi || movement.bankName || "",
    fisNo,
    fisTarihi: tarih,
    fisAciklama,
    belgeTuru: belgeTuru || movement.documentType || "DK",
    belgeNo: "",
    hesapKodu,
    evrakNo: movement.rawRow?.dekontNo || "",
    evrakTarihi: tarih,
    detayAciklama,
    borc,
    alacak,
    kontrolNotu: movement.warning || "",
    hafizaEslesme: String(movement.warning || "").includes(MEMORY_MATCH_LABEL),
    _movementId: movement.id,
  });
}

export function bankMovementToStandardLucaRows(movement, fisNo, context = {}) {
  const tutar = Math.abs(Number(movement.amount || 0));
  if (!tutar) return [];

  const lucaAciklama = movement.lucaDescription || movement.description || "";
  const belgeTuru = movement.documentType || "DK";
  const matchedRule = movement.matchedRule;
  const bankaHesap = movement.accountCode;
  const karsiHesap = movement.counterAccountCode;
  const rows = [];

  if (matchedRule?.ozelIslem === "BINEK_ARAC_GIDER_KISITLAMASI") {
    const giderTutar = Number((tutar * matchedRule.giderOrani).toFixed(2));
    const kkegTutar = Number((tutar * matchedRule.kkegOrani).toFixed(2));

    rows.push(
      buildBankLucaLine({
        movement,
        fisNo,
        context,
        hesapKodu: bankaHesap,
        borc: "",
        alacak: tutar,
        fisAciklama: lucaAciklama,
        detayAciklama: lucaAciklama,
        belgeTuru,
      }),
      buildBankLucaLine({
        movement,
        fisNo,
        context,
        hesapKodu: matchedRule.hesap,
        borc: giderTutar,
        alacak: "",
        fisAciklama: lucaAciklama,
        detayAciklama: lucaAciklama,
        belgeTuru,
      }),
      buildBankLucaLine({
        movement,
        fisNo,
        context,
        hesapKodu: matchedRule.kkegHesap,
        borc: kkegTutar,
        alacak: "",
        fisAciklama: matchedRule.kkegAciklama,
        detayAciklama: matchedRule.kkegAciklama,
        belgeTuru,
      })
    );

    return rows;
  }

  rows.push(
    buildBankLucaLine({
      movement,
      fisNo,
      context,
      hesapKodu: bankaHesap,
      borc: movement.direction === "GIRIS" ? tutar : "",
      alacak: movement.direction === "CIKIS" ? tutar : "",
      fisAciklama: lucaAciklama,
      detayAciklama: lucaAciklama,
      belgeTuru,
    }),
    buildBankLucaLine({
      movement,
      fisNo,
      context,
      hesapKodu: karsiHesap,
      borc: movement.direction === "CIKIS" ? tutar : "",
      alacak: movement.direction === "GIRIS" ? tutar : "",
      fisAciklama: lucaAciklama,
      detayAciklama: lucaAciklama,
      belgeTuru,
    })
  );

  return rows;
}

export function groupedTebHavaleToStandardLucaRows(group, fisNo, context = {}) {
  const mainMovement = group.mainMovement;
  const masrafTotal = Number(group.masrafTotal || 0);
  const mainAmount = Math.abs(Number(mainMovement.amount || 0));
  if (!mainAmount) return [];

  const bankAccount = mainMovement.accountCode;
  const cariAccount = mainMovement.counterAccountCode;
  const totalOut = Number((mainAmount + masrafTotal).toFixed(2));
  const fisAciklama = buildGroupedCariDescription(mainMovement);
  const belgeTuru = mainMovement.documentType || "DK";

  const rows = [
    buildBankLucaLine({
      movement: mainMovement,
      fisNo,
      context,
      hesapKodu: bankAccount,
      borc: "",
      alacak: totalOut,
      fisAciklama,
      detayAciklama: fisAciklama,
      belgeTuru,
    }),
    buildBankLucaLine({
      movement: mainMovement,
      fisNo,
      context,
      hesapKodu: cariAccount,
      borc: mainAmount,
      alacak: "",
      fisAciklama,
      detayAciklama: fisAciklama,
      belgeTuru,
    }),
  ];

  if (masrafTotal > 0) {
    rows.push(
      buildBankLucaLine({
        movement: mainMovement,
        fisNo,
        context,
        hesapKodu: TEB_MASRAF_ACCOUNT,
        borc: masrafTotal,
        alacak: "",
        fisAciklama,
        detayAciklama: TEB_MASRAF_DESCRIPTION,
        belgeTuru,
      })
    );
  }

  return rows;
}

export function tebUnmatchedMasrafToStandardLucaRows(movement, fisNo, context = {}) {
  const tutar = Math.abs(Number(movement.amount || 0));
  if (!tutar) return [];

  const movementWithNote = {
    ...movement,
    warning: appendControlNote(movement.warning, TEB_UNMATCHED_MASRAF_NOTE),
  };
  const bankAccount = movement.accountCode;
  const belgeTuru = movement.documentType || "DK";

  return [
    buildBankLucaLine({
      movement: movementWithNote,
      fisNo,
      context,
      hesapKodu: bankAccount,
      borc: "",
      alacak: tutar,
      fisAciklama: TEB_MASRAF_DESCRIPTION,
      detayAciklama: TEB_MASRAF_DESCRIPTION,
      belgeTuru,
    }),
    buildBankLucaLine({
      movement: movementWithNote,
      fisNo,
      context,
      hesapKodu: TEB_MASRAF_ACCOUNT,
      borc: tutar,
      alacak: "",
      fisAciklama: TEB_MASRAF_DESCRIPTION,
      detayAciklama: TEB_MASRAF_DESCRIPTION,
      belgeTuru,
    }),
  ];
}

export function bankMovementsToStandardLucaRows(movements = [], context = {}) {
  const rows = [];
  const bankName = String(context.kaynakAdi || context.bankName || "")
    .trim()
    .toUpperCase();

  if (bankName === "TEB") {
    const { outputItems, report } = groupTebHavaleMovements(movements);
    logTebHavaleGroupingReport(report);

    let fisNo = 1;

    outputItems.forEach((item) => {
      if (item.kind === "teb_havale_group") {
        rows.push(...groupedTebHavaleToStandardLucaRows(item, fisNo, context));
      } else if (item.kind === "teb_unmatched_masraf") {
        rows.push(...tebUnmatchedMasrafToStandardLucaRows(item.movement, fisNo, context));
      } else {
        rows.push(...bankMovementToStandardLucaRows(item.movement, fisNo, context));
      }
      fisNo += 1;
    });

    return sortStandardLucaRows(rows);
  }

  movements.forEach((movement, index) => {
    const fisNo = index + 1;
    rows.push(...bankMovementToStandardLucaRows(movement, fisNo, context));
  });

  return sortStandardLucaRows(rows);
}

export function stripStandardLucaRow(row) {
  return {
    firmaId: row.firmaId,
    kaynakTipi: row.kaynakTipi,
    kaynakAdi: row.kaynakAdi,
    fisNo: row.fisNo,
    fisTarihi: row.fisTarihi,
    fisAciklama: row.fisAciklama,
    belgeTuru: row.belgeTuru,
    belgeNo: row.belgeNo,
    hesapKodu: row.hesapKodu,
    evrakNo: row.evrakNo,
    evrakTarihi: row.evrakTarihi,
    detayAciklama: row.detayAciklama,
    borc: row.borc,
    alacak: row.alacak,
    riskDurumu: row.riskDurumu,
    kontrolNotu: row.kontrolNotu,
    hafizaEslesme: row.hafizaEslesme,
  };
}

export function getStandardLucaMissingBadges(row) {
  const badges = [];

  if (!String(row?.hesapKodu || "").trim()) {
    badges.push(row.riskDurumu === "HESAP_EKSIK" ? "HESAP_EKSIK" : "Hesap eksik");
  }

  if (!String(row?.detayAciklama || row?.fisAciklama || "").trim()) {
    badges.push("Açıklama eksik");
  }

  if (!String(row?.belgeTuru || "").trim()) {
    badges.push("Belge türü eksik");
  }

  return badges;
}

export function computeStandardLucaReport(rows = []) {
  const fisTotals = new Map();
  let bosHesapSayisi = 0;
  let bosAciklamaSayisi = 0;

  for (const row of rows) {
    if (!String(row.hesapKodu || "").trim()) bosHesapSayisi += 1;
    if (!String(row.detayAciklama || row.fisAciklama || "").trim()) {
      bosAciklamaSayisi += 1;
    }

    const key = String(row.fisNo || "");
    const current = fisTotals.get(key) || { borc: 0, alacak: 0 };
    current.borc += Number(row.borc || 0);
    current.alacak += Number(row.alacak || 0);
    fisTotals.set(key, current);
  }

  let dengesizFisSayisi = 0;

  for (const totals of fisTotals.values()) {
    if (Math.abs(totals.borc - totals.alacak) > 0.01) {
      dengesizFisSayisi += 1;
    }
  }

  return {
    toplamFis: fisTotals.size,
    toplamSatir: rows.length,
    bosHesapSayisi,
    bosAciklamaSayisi,
    dengesizFisSayisi,
  };
}

export function logStandardLucaReport(label, rows = []) {
  const report = computeStandardLucaReport(rows);
  console.log(`[${label}] StandardLucaRow report`, report);
  return report;
}

export function standardLucaRowsToExcelRows(rows = []) {
  return rows.map((row) => ({
    "Fiş No": row.fisNo,
    "Fiş Tarihi": formatDateTR(row.fisTarihi),
    "Fiş Açıklama": row.fisAciklama || row.detayAciklama || "",
    "Hesap Kodu": String(row.hesapKodu || "").trim(),
    "Evrak No": row.evrakNo || "",
    "Evrak Tarihi": formatDateTR(row.evrakTarihi || row.fisTarihi),
    "Detay Açıklama": row.detayAciklama || row.fisAciklama || "",
    Borç: row.borc || "",
    Alacak: row.alacak || "",
    Miktar: "",
    "Belge Türü": row.belgeTuru || "",
    "Para Birimi": "",
    Kur: "",
    "Döviz Tutar": "",
  }));
}

export function groupStandardLucaRowsToFisler(rows = []) {
  const sortedRows = sortStandardLucaRows(rows);
  const grouped = new Map();
  const order = [];

  for (const row of sortedRows) {
    const key = String(row.fisNo || "");

    if (!grouped.has(key)) {
      grouped.set(key, {
        fisNo: Number(row.fisNo) || row.fisNo,
        tarih: row.fisTarihi,
        aciklama: row.fisAciklama || row.detayAciklama || "",
        belgeTuru: row.belgeTuru || "",
        satirlar: [],
      });
      order.push(key);
    }

    grouped.get(key).satirlar.push({
      hesapKodu: row.hesapKodu || "",
      aciklama: row.detayAciklama || row.fisAciklama || "",
      borc: row.borc || "",
      alacak: row.alacak || "",
    });
  }

  return order.map((key) => grouped.get(key)).filter(Boolean);
}

export function lucaFislerToStandardLucaRows(fisler = [], context = {}) {
  const rows = [];

  for (const fis of fisler) {
    for (const satir of fis.satirlar || []) {
      rows.push(
        finalizeStandardLucaRow({
          firmaId: context.firmaId || "",
          kaynakTipi: context.kaynakTipi || KAYNAK_TIPI.BANKA,
          kaynakAdi: context.kaynakAdi || "",
          fisNo: fis.fisNo,
          fisTarihi: fis.tarih,
          fisAciklama: fis.aciklama,
          belgeTuru: fis.belgeTuru || "DK",
          hesapKodu: satir.hesapKodu,
          detayAciklama: satir.aciklama || fis.aciklama,
          borc: satir.borc,
          alacak: satir.alacak,
          kontrolNotu: satir.uyari || fis.uyari || "",
          hafizaEslesme: String(satir.uyari || fis.uyari || "").includes(
            MEMORY_MATCH_LABEL
          ),
        })
      );
    }
  }

  return sortStandardLucaRows(rows);
}

export function isStandardLucaPayload(payload) {
  if (!payload?.rows?.length) return false;

  if (
    payload.format === STANDARD_LUCA_ROW_FORMAT ||
    payload.format === "luca-voucher-v1"
  ) {
    return true;
  }

  const firstRow = payload.rows[0];
  return (
    Object.prototype.hasOwnProperty.call(firstRow, "fisTarihi") &&
    Object.prototype.hasOwnProperty.call(firstRow, "fisNo")
  );
}

export function buildStandardLucaTransferPayload({
  firmaId,
  companyName,
  kaynakTipi,
  kaynakAdi,
  rows,
}) {
  return {
    format: STANDARD_LUCA_ROW_FORMAT,
    firmaId,
    companyId: firmaId,
    companyName,
    kaynakTipi,
    kaynakAdi,
    createdAt: new Date().toISOString(),
    rows: sortStandardLucaRows(rows.map(stripStandardLucaRow)),
  };
}

export function filterStandardLucaRows(rows, query, quickFilter) {
  const search = String(query || "").trim().toLocaleLowerCase("tr");

  return rows.filter((row) => {
    if (quickFilter === "errors" && !row.riskDurumu && !row.kontrolNotu) {
      return false;
    }

    if (quickFilter === "missingAccount" && row.riskDurumu !== "HESAP_EKSIK") {
      return false;
    }

    if (quickFilter === "learningMemory" && !row.hafizaEslesme) {
      return false;
    }

    if (quickFilter === "missingDescription") {
      if (String(row.detayAciklama || row.fisAciklama || "").trim()) return false;
    }

    if (quickFilter === "missingDocumentType") {
      if (String(row.belgeTuru || "").trim()) return false;
    }

    if (!search) return true;

    const haystack = [
      row.fisNo,
      row.fisTarihi,
      row.fisAciklama,
      row.detayAciklama,
      row.hesapKodu,
      row.belgeTuru,
      row.kontrolNotu,
      row.riskDurumu,
      row.borc,
      row.alacak,
      row.kaynakAdi,
    ]
      .join(" ")
      .toLocaleLowerCase("tr");

    return haystack.includes(search);
  });
}
