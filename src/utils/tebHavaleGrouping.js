import {
  buildFallbackLucaDescription,
  formatParserDate,
  normalizeParserText,
} from "@/src/utils/bankMovementMapper";

export const TEB_MASRAF_ACCOUNT = "780.01.001";
export const TEB_MASRAF_DESCRIPTION = "HAVALE/EFT MASRAFI";
export const TEB_UNMATCHED_MASRAF_NOTE =
  "Masraf ana havale hareketiyle eşleştirilemedi";

const EXPLICIT_MASRAF_KEYWORDS = [
  "HAVALE/EFT MASRAFI",
  "HAVALE MASRAF",
  "EFT MASRAF",
  "EFT MASRAFI",
  "BSMV",
  "KOMISYON",
  "KOMİSYON",
  "HAVALE UCRET",
  "HAVALE ÜCRET",
  "HAVALE UCRETI",
  "HAVALE ÜCRETİ",
  "EFT UCRET",
  "EFT ÜCRET",
  "EFT UCRETI",
  "EFT ÜCRETİ",
  "FAST UCRET",
  "FAST ÜCRET",
  "BKM UCR",
  "BKM UCRET",
  "KESINTI",
  "KESİNTİ",
];

const PROXIMITY_WINDOW = 6;

function normalizeDekont(value) {
  return String(value || "").trim();
}

function isSyntheticDekont(dekont) {
  const text = normalizeDekont(dekont);
  if (!text) return true;
  return /^(TEB|KUVEYT|ZIRAAT|GARANTI|VAKIFBANK)-\d+$/i.test(text);
}

function resolveDekontForMatching(row) {
  let dekontNo = normalizeDekont(row?.dekontNo || row?.Dekont || "");

  if (isSyntheticDekont(dekontNo)) {
    dekontNo = "";
  }

  if (!dekontNo) {
    const ref = extractTransactionReference(row?.aciklama || row?.description || "");
    if (ref) dekontNo = ref;
  }

  return dekontNo;
}

function extractTransactionReference(description) {
  const text = String(description || "");
  const matches = text.match(/\b(\d{6,})\b/g);
  if (!matches?.length) return "";

  return matches.sort((left, right) => right.length - left.length)[0];
}

export function isTebMasrafMovement(movement) {
  const text = normalizeParserText(movement?.description || "");
  const amount = Math.abs(Number(movement?.amount || 0));

  if (!amount) return false;

  if (
    movement?.counterAccountCode === TEB_MASRAF_ACCOUNT ||
    movement?.matchedRule?.hesap === TEB_MASRAF_ACCOUNT
  ) {
    return amount > 0 && amount <= 500;
  }

  if (
    EXPLICIT_MASRAF_KEYWORDS.some((keyword) =>
      text.includes(normalizeParserText(keyword))
    )
  ) {
    return true;
  }

  if (
    (text.includes("MASRAF") || text.includes("UCRET") || text.includes("ÜCRET")) &&
    amount <= 500
  ) {
    return true;
  }

  return false;
}

export function isTebMainHavaleMovement(movement) {
  if (!movement || movement.direction !== "CIKIS") return false;
  if (isTebMasrafMovement(movement)) return false;

  const text = normalizeParserText(movement.description || "");

  if (
    text.includes("KREDI KART") ||
    text.includes("EKSTRE BORC") ||
    text.includes("SGK") ||
    text.includes("VERGI")
  ) {
    return false;
  }

  const counter = String(movement.counterAccountCode || "");
  const hasCariLikeAccount =
    counter.startsWith("320") ||
    counter.startsWith("120") ||
    counter.startsWith("335") ||
    counter.startsWith("196") ||
    counter.startsWith("331");

  const transferLike =
    text.includes("GON") ||
    text.includes("HVL") ||
    text.includes("HAVALE") ||
    text.includes("EFT") ||
    text.includes("FAST") ||
    text.includes("INT") ||
    text.includes("MOBIL") ||
    text.includes("CEP SUBE");

  return transferLike || hasCariLikeAccount;
}

export function buildGroupedCariDescription(mainMovement) {
  const luca = String(mainMovement?.lucaDescription || "").trim();
  if (/^G[ÖO]ND\.?\s*HVL/i.test(luca)) {
    return luca;
  }

  const unvan = String(mainMovement?.rawRow?.unvan || "").trim();
  if (unvan) {
    return `GÖND. HVL / ${unvan}`;
  }

  return buildFallbackLucaDescription({
    aciklama: mainMovement?.description,
    description: mainMovement?.description,
    yon: "CIKIS",
  });
}

function masrafAmountIsReasonableForMain(mainMovement, masrafMovement) {
  const mainAmount = Math.abs(Number(mainMovement?.amount || 0));
  const masrafAmount = Math.abs(Number(masrafMovement?.amount || 0));
  if (!mainAmount || !masrafAmount) return false;
  if (masrafAmount >= mainAmount) return false;
  return masrafAmount <= Math.max(500, mainAmount * 0.05);
}

function getMovementDekont(movement) {
  return resolveDekontForMatching({
    dekontNo: movement?.rawRow?.dekontNo,
    aciklama: movement?.description,
  });
}

function assignMasrafToMains(mainHavaleMovements, masrafMovements, indexById) {
  const mainToMasraf = new Map(
    mainHavaleMovements.map((movement) => [movement.id, []])
  );
  const usedMasrafIds = new Set();

  const assign = (masraf, main) => {
    if (usedMasrafIds.has(masraf.id)) return false;
    if (!masrafAmountIsReasonableForMain(main, masraf)) return false;

    mainToMasraf.get(main.id).push(masraf);
    usedMasrafIds.add(masraf.id);
    return true;
  };

  for (const masraf of masrafMovements) {
    const masrafDekont = getMovementDekont(masraf);
    if (!masrafDekont) continue;

    for (const main of mainHavaleMovements) {
      if (getMovementDekont(main) !== masrafDekont) continue;
      if (assign(masraf, main)) break;
    }
  }

  for (const masraf of masrafMovements) {
    if (usedMasrafIds.has(masraf.id)) continue;

    const masrafRef = extractTransactionReference(masraf.description);
    if (!masrafRef) continue;

    for (const main of mainHavaleMovements) {
      if (formatParserDate(masraf.date) !== formatParserDate(main.date)) continue;
      if (extractTransactionReference(main.description) !== masrafRef) continue;
      if (assign(masraf, main)) break;
    }
  }

  for (const masraf of masrafMovements) {
    if (usedMasrafIds.has(masraf.id)) continue;

    const masrafIndex = indexById.get(masraf.id);
    if (masrafIndex === undefined) continue;

    let bestMain = null;
    let bestDistance = Infinity;

    for (const main of mainHavaleMovements) {
      if (formatParserDate(masraf.date) !== formatParserDate(main.date)) continue;
      if (!masrafAmountIsReasonableForMain(main, masraf)) continue;

      const mainIndex = indexById.get(main.id);
      if (mainIndex === undefined) continue;

      const distance = Math.abs(mainIndex - masrafIndex);
      if (distance > PROXIMITY_WINDOW || distance >= bestDistance) continue;

      bestDistance = distance;
      bestMain = main;
    }

    if (bestMain) assign(masraf, bestMain);
  }

  return { mainToMasraf, usedMasrafIds };
}

function isTebMasrafParsedRow(row) {
  const amount = Math.abs(Number(row?.tutar ?? row?.amount ?? 0));
  return isTebMasrafMovement({
    description: row?.aciklama || row?.description || "",
    direction: row?.yon || row?.direction || "CIKIS",
    amount,
    counterAccountCode: "",
  });
}

export function enrichTebParsedRows(parsedRows = []) {
  let lastDekont = "";
  let lastDate = "";

  return parsedRows.map((row) => {
    const date = formatParserDate(row?.tarih || row?.date || "");
    let dekontNo = resolveDekontForMatching(row);

    if (date !== lastDate) {
      lastDekont = "";
    }

    if (dekontNo && !isSyntheticDekont(dekontNo)) {
      lastDekont = dekontNo;
    } else if (isTebMasrafParsedRow(row) && lastDekont && date === lastDate) {
      dekontNo = lastDekont;
    }

    lastDate = date;

    return {
      ...row,
      dekontNo,
      unvan: String(row?.unvan || row?.Unvan || "").trim(),
    };
  });
}

export function groupTebHavaleMovements(movements = []) {
  const indexById = new Map();
  movements.forEach((movement, index) => {
    indexById.set(movement.id, index);
  });

  const masrafMovements = movements.filter(isTebMasrafMovement);
  const mainHavaleMovements = movements.filter(isTebMainHavaleMovement);
  const { mainToMasraf, usedMasrafIds } = assignMasrafToMains(
    mainHavaleMovements,
    masrafMovements,
    indexById
  );

  const unmatchedMasraf = masrafMovements.filter(
    (movement) => !usedMasrafIds.has(movement.id)
  );

  const outputItems = [];
  let matchedMasrafCount = 0;

  movements.forEach((movement) => {
    if (isTebMasrafMovement(movement)) return;

    if (isTebMainHavaleMovement(movement)) {
      const masrafMovementsForMain = mainToMasraf.get(movement.id) || [];
      matchedMasrafCount += masrafMovementsForMain.length;
      const masrafTotal = Number(
        masrafMovementsForMain
          .reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0)
          .toFixed(2)
      );

      if (masrafTotal > 0) {
        outputItems.push({
          kind: "teb_havale_group",
          mainMovement: movement,
          masrafMovements: masrafMovementsForMain,
          masrafTotal,
        });
      } else {
        outputItems.push({ kind: "movement", movement });
      }
      return;
    }

    outputItems.push({ kind: "movement", movement });
  });

  unmatchedMasraf.forEach((movement) => {
    outputItems.push({ kind: "teb_unmatched_masraf", movement });
  });

  const report = {
    anaHavaleSayisi: mainHavaleMovements.length,
    eslesenMasrafSayisi: matchedMasrafCount,
    eslesmeyenMasrafSayisi: unmatchedMasraf.length,
    masrafToplami: Number(
      masrafMovements
        .reduce((sum, movement) => sum + Math.abs(Number(movement.amount || 0)), 0)
        .toFixed(2)
    ),
    grupSayisi: outputItems.filter((item) => item.kind === "teb_havale_group").length,
  };

  return { outputItems, report };
}

export function logTebHavaleGroupingReport(report = {}) {
  console.log("[teb-havale-grouping] TEB ana havale sayısı", report.anaHavaleSayisi || 0);
  console.log("[teb-havale-grouping] eşleşen masraf sayısı", report.eslesenMasrafSayisi || 0);
  console.log(
    "[teb-havale-grouping] eşleşemeyen masraf sayısı",
    report.eslesmeyenMasrafSayisi || 0
  );
  console.log("[teb-havale-grouping] toplam masraf tutarı", report.masrafToplami || 0);
}

export function appendControlNote(existingNote, extraNote) {
  const current = String(existingNote || "").trim();
  const next = String(extraNote || "").trim();
  if (!next) return current;
  if (!current) return next;
  if (current.includes(next)) return current;
  return `${current} | ${next}`;
}
