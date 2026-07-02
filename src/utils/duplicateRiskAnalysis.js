import { parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { normalizeParserText } from "@/src/utils/textNormalize";

export const MUKERRER_RISK_SEVIYE = {
  DUSUK: "Düşük",
  ORTA: "Orta",
  YUKSEK: "Yüksek",
  KRITIK: "Kritik",
};

const NEAR_DATE_DAYS = 3;

function getRowDescription(row = {}) {
  return String(row.detayAciklama || row.fisAciklama || row.aciklama || "").trim();
}

function getRowAmount(row = {}) {
  const borc = parseMoneyTR(row.borc);
  const alacak = parseMoneyTR(row.alacak);
  return borc > 0 ? borc : alacak;
}

function getCariName(row = {}) {
  return String(row.cariUnvan || row.hesapAdi || "").trim();
}

function getEvrakNo(row = {}) {
  return String(row.evrakNo || row.belgeNo || "").trim();
}

function normalizeEvrakNo(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function parseRowDate(row = {}) {
  const text = String(row.fisTarihi || row.evrakTarihi || "").trim();
  if (!text) return null;
  const parsed = parseDateTR(text);
  if (!parsed) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function daysBetween(leftDate, rightDate) {
  if (!leftDate || !rightDate) return null;
  const diffMs = Math.abs(leftDate.getTime() - rightDate.getTime());
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function formatDayDistance(days) {
  if (days === null || days === undefined) return "";
  if (days === 0) return "aynı gün";
  if (days === 1) return "1 gün önce";
  return `${days} gün önce`;
}

function tokenize(text) {
  return normalizeParserText(text)
    .split(" ")
    .filter((token) => token.length >= 3);
}

export function descriptionSimilarity(left, right) {
  const normalizedLeft = normalizeParserText(left);
  const normalizedRight = normalizeParserText(right);

  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  if (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    const shorter = Math.min(normalizedLeft.length, normalizedRight.length);
    const longer = Math.max(normalizedLeft.length, normalizedRight.length);
    return shorter / longer;
  }

  const leftTokens = new Set(tokenize(normalizedLeft));
  const rightTokens = tokenize(normalizedRight);

  if (!leftTokens.size || !rightTokens.length) return 0;

  let overlap = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) overlap += 1;
  }

  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  return unionSize ? overlap / unionSize : 0;
}

function amountsEqual(leftAmount, rightAmount) {
  if (leftAmount <= 0 || rightAmount <= 0) return false;
  return Math.abs(leftAmount - rightAmount) <= 0.01;
}

function createSignal(score, message, critical = false, type = "") {
  return {
    score: Math.min(100, Math.max(0, Math.round(score))),
    message,
    critical,
    type,
  };
}

function compareDuplicateRows(currentRow, previousRow, currentIndex, previousIndex) {
  const signals = [];
  const currentDescription = getRowDescription(currentRow);
  const previousDescription = getRowDescription(previousRow);
  const currentAmount = getRowAmount(currentRow);
  const previousAmount = getRowAmount(previousRow);
  const sameAmount = amountsEqual(currentAmount, previousAmount);
  const similarity = descriptionSimilarity(currentDescription, previousDescription);
  const currentDate = parseRowDate(currentRow);
  const previousDate = parseRowDate(previousRow);
  const dayDistance =
    currentDate && previousDate ? daysBetween(currentDate, previousDate) : null;
  const nearDate =
    dayDistance !== null && dayDistance <= NEAR_DATE_DAYS;
  const sameDate = dayDistance === 0;
  const dayLabel = formatDayDistance(dayDistance);
  const previousRowLabel = `${previousIndex + 1}. satır`;

  if (
    sameDate &&
    sameAmount &&
    similarity >= 0.99 &&
    currentDescription &&
    previousDescription
  ) {
    signals.push(
      createSignal(
        100,
        `Aynı tarih, açıklama ve tutar ile ${previousRowLabel} tekrar ediyor.`,
        true,
        "exact-triple"
      )
    );
  }

  if (nearDate && sameAmount && similarity >= 0.99 && !sameDate) {
    signals.push(
      createSignal(
        94,
        `Aynı tutar ve açıklama ile ${dayLabel} kayıt var (${previousRowLabel}).`,
        true,
        "near-date-exact-desc"
      )
    );
  }

  const currentEvrak = getEvrakNo(currentRow);
  const previousEvrak = getEvrakNo(previousRow);

  if (currentEvrak && previousEvrak && normalizeEvrakNo(currentEvrak) === normalizeEvrakNo(previousEvrak)) {
    signals.push(
      createSignal(
        sameAmount ? 92 : 78,
        sameAmount
          ? `Aynı belge no "${currentEvrak}" ve aynı tutar daha önce kullanılmış olabilir (${previousRowLabel}).`
          : `Aynı belge no "${currentEvrak}" daha önce kullanılmış olabilir (${previousRowLabel}).`,
        sameAmount,
        "duplicate-evrak"
      )
    );
  }

  const currentCari = getCariName(currentRow);
  const previousCari = getCariName(previousRow);

  if (
    currentCari &&
    previousCari &&
    normalizeParserText(currentCari) === normalizeParserText(previousCari) &&
    sameAmount
  ) {
    signals.push(
      createSignal(
        84,
        `Aynı cari ve aynı tutar nedeniyle mükerrer riski yüksek (${previousRowLabel}).`,
        false,
        "same-cari-amount"
      )
    );
  }

  const currentKarsi = String(currentRow.karsiHesapKodu || "").trim();
  const previousKarsi = String(previousRow.karsiHesapKodu || "").trim();

  if (sameAmount && currentKarsi && previousKarsi && currentKarsi === previousKarsi) {
    signals.push(
      createSignal(
        76,
        `Aynı tutar ve aynı karşı hesap ile ${previousRowLabel} eşleşiyor.`,
        false,
        "same-amount-counter"
      )
    );
  }

  if (sameAmount && similarity >= 0.85) {
    signals.push(
      createSignal(
        sameDate ? 88 : nearDate ? 82 : 78,
        sameDate
          ? `Aynı tutar ve benzer açıklama ile ${previousRowLabel} kayıt var.`
          : `Aynı tutar ve benzer açıklama ile ${dayLabel || "yakın tarihte"} kayıt var (${previousRowLabel}).`,
        false,
        "same-amount-similar-desc"
      )
    );
  } else if (sameAmount && similarity >= 0.72) {
    signals.push(
      createSignal(
        nearDate ? 62 : 48,
        `Benzer açıklama ve aynı tutar nedeniyle mükerrer riski var (${previousRowLabel}).`,
        false,
        "same-amount-moderate-desc"
      )
    );
  } else if (nearDate && sameAmount && similarity >= 0.55) {
    signals.push(
      createSignal(
        40 + Math.round(similarity * 20),
        `Yakın tarihte (${dayLabel}) aynı tutar ve benzer açıklama bulundu (${previousRowLabel}).`,
        false,
        "near-date-similar"
      )
    );
  }

  return signals;
}

function resolveRiskLevel(score, isCritical) {
  if (isCritical || score >= 95) return MUKERRER_RISK_SEVIYE.KRITIK;
  if (score >= 70) return MUKERRER_RISK_SEVIYE.YUKSEK;
  if (score >= 31) return MUKERRER_RISK_SEVIYE.ORTA;
  return MUKERRER_RISK_SEVIYE.DUSUK;
}

function mergeRowSignals(existingSignals, newSignals) {
  const merged = [...existingSignals];

  for (const signal of newSignals) {
    const duplicate = merged.some(
      (item) => item.type === signal.type && item.message === signal.message
    );
    if (!duplicate) merged.push(signal);
  }

  return merged;
}

export function analyzeDuplicateRiskForRows(rows = []) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const rowResults = sourceRows.map((row, index) => ({
    rowId: row.id,
    rowIndex: index + 1,
    fisNo: row.fisNo ?? "—",
    riskScore: 0,
    riskLevel: MUKERRER_RISK_SEVIYE.DUSUK,
    isCritical: false,
    messages: [],
    signals: [],
  }));

  for (let index = 0; index < sourceRows.length; index += 1) {
    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const signals = compareDuplicateRows(
        sourceRows[index],
        sourceRows[previousIndex],
        index,
        previousIndex
      );

      if (!signals.length) continue;

      rowResults[index].signals = mergeRowSignals(rowResults[index].signals, signals);
    }

    const bestSignal = rowResults[index].signals.reduce(
      (best, signal) => (!best || signal.score > best.score ? signal : best),
      null
    );

    if (bestSignal) {
      rowResults[index].riskScore = bestSignal.score;
      rowResults[index].isCritical = rowResults[index].signals.some((signal) => signal.critical);
      rowResults[index].riskLevel = resolveRiskLevel(
        rowResults[index].riskScore,
        rowResults[index].isCritical
      );
      rowResults[index].messages = rowResults[index].signals.map((signal) => signal.message);
    }
  }

  const criticalCount = rowResults.filter((row) => row.isCritical).length;
  const highCount = rowResults.filter(
    (row) => !row.isCritical && row.riskScore >= 70
  ).length;
  const mediumCount = rowResults.filter(
    (row) => row.riskScore >= 31 && row.riskScore < 70
  ).length;
  const lowCount = rowResults.filter((row) => row.riskScore < 31).length;

  return {
    rows: rowResults,
    byRowId: new Map(rowResults.filter((row) => row.rowId).map((row) => [row.rowId, row])),
    summary: {
      totalRows: rowResults.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      hasCritical: criticalCount > 0,
      hasHighRisk: highCount > 0 || criticalCount > 0,
      hasMediumRisk: mediumCount > 0,
    },
  };
}
