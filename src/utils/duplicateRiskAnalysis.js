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

function getSourceMovementId(row = {}) {
  return String(row.sourceMovementId || row._movementId || "").trim();
}

function getLineRole(row = {}) {
  if (parseMoneyTR(row.borc) > 0) return "borc";
  if (parseMoneyTR(row.alacak) > 0) return "alacak";
  return "empty";
}

function sameFisNo(left = {}, right = {}) {
  const a = String(left.fisNo ?? "").trim();
  const b = String(right.fisNo ?? "").trim();
  return Boolean(a) && a === b;
}

/** Beklenen çift taraflı muhasebe: aynı fiş, zıt borç/alacak */
export function isExpectedDoubleEntryPair(left = {}, right = {}) {
  if (!sameFisNo(left, right)) return false;
  const leftRole = getLineRole(left);
  const rightRole = getLineRole(right);
  if (leftRole === "empty" || rightRole === "empty") return false;
  return leftRole !== rightRole;
}

/** Aynı hareketten doğan farklı hesap kalemleri (dağılım / masraf) */
function isSameMovementDifferentLeg(left = {}, right = {}) {
  const leftId = getSourceMovementId(left);
  const rightId = getSourceMovementId(right);
  if (!leftId || leftId !== rightId) return false;
  const leftHesap = normalizeParserText(left.hesapKodu || "");
  const rightHesap = normalizeParserText(right.hesapKodu || "");
  const leftRole = getLineRole(left);
  const rightRole = getLineRole(right);
  return leftHesap !== rightHesap || leftRole !== rightRole;
}

/**
 * Gerçek kritik mükerrer anahtarı.
 * Yalnızca tarih+tutar+açıklama KULLANILMAZ.
 */
export function buildCriticalDuplicateKey(row = {}) {
  const movementId = getSourceMovementId(row);
  const date = normalizeParserText(String(row.fisTarihi || row.evrakTarihi || ""));
  const amount = getRowAmount(row).toFixed(2);
  const role = getLineRole(row);
  const hesap = normalizeParserText(String(row.hesapKodu || ""));
  const bankAccount = normalizeParserText(
    String(row.lucaBankaHesabi || row.bankaHesapKodu || "")
  );
  const belge = normalizeEvrakNo(getEvrakNo(row));
  const fisNo = String(row.fisNo ?? "").trim();
  return [movementId, fisNo, date, amount, role, hesap, bankAccount, belge].join("|");
}

function compareDuplicateRows(currentRow, previousRow, currentIndex, previousIndex) {
  if (isExpectedDoubleEntryPair(currentRow, previousRow)) {
    return [
      createSignal(
        0,
        `Beklenen borç/alacak çifti (Fiş ${currentRow.fisNo}) — mükerrer değil.`,
        false,
        "expected-double-entry"
      ),
    ];
  }

  if (isSameMovementDifferentLeg(currentRow, previousRow)) {
    return [
      createSignal(
        0,
        `Aynı hareketin farklı muhasebe kalemi (${previousIndex + 1}. satır) — mükerrer değil.`,
        false,
        "same-movement-split"
      ),
    ];
  }

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
  const nearDate = dayDistance !== null && dayDistance <= NEAR_DATE_DAYS;
  const sameDate = dayDistance === 0;
  const dayLabel = formatDayDistance(dayDistance);
  const previousRowLabel = `${previousIndex + 1}. satır`;

  const currentKey = buildCriticalDuplicateKey(currentRow);
  const previousKey = buildCriticalDuplicateKey(previousRow);
  const currentMovementId = getSourceMovementId(currentRow);
  const previousMovementId = getSourceMovementId(previousRow);

  if (
    currentKey &&
    currentKey === previousKey &&
    currentMovementId &&
    previousMovementId &&
    getLineRole(currentRow) !== "empty"
  ) {
    signals.push(
      createSignal(
        100,
        `Kritik mükerrer: aynı hareket kimliği, tarih, tutar, yön, hesap ve satır rolü (${previousRowLabel}).`,
        true,
        "critical-same-leg"
      )
    );
    return signals;
  }

  // Eski exact-triple artık KRİTİK değil — şüpheli benzer kayıt
  if (
    sameDate &&
    sameAmount &&
    similarity >= 0.99 &&
    currentDescription &&
    previousDescription
  ) {
    signals.push(
      createSignal(
        88,
        `Şüpheli benzer kayıt: aynı tarih/tutar/açıklama (${previousRowLabel}). Farklı hareket olabilir.`,
        false,
        "suspicious-triple"
      )
    );
  }

  if (nearDate && sameAmount && similarity >= 0.99 && !sameDate) {
    signals.push(
      createSignal(
        82,
        `Şüpheli: aynı tutar/açıklama, ${dayLabel} (${previousRowLabel}).`,
        false,
        "near-date-exact-desc"
      )
    );
  }

  const currentEvrak = getEvrakNo(currentRow);
  const previousEvrak = getEvrakNo(previousRow);

  if (
    currentEvrak &&
    previousEvrak &&
    normalizeEvrakNo(currentEvrak) === normalizeEvrakNo(previousEvrak)
  ) {
    const sameLeg =
      getLineRole(currentRow) === getLineRole(previousRow) &&
      normalizeParserText(currentRow.hesapKodu || "") ===
        normalizeParserText(previousRow.hesapKodu || "");
    signals.push(
      createSignal(
        sameAmount && sameLeg ? 96 : sameAmount ? 78 : 60,
        sameAmount && sameLeg
          ? `Kritik: aynı belge no "${currentEvrak}", tutar, hesap ve yön (${previousRowLabel}).`
          : `Aynı belge no "${currentEvrak}" daha önce kullanılmış olabilir (${previousRowLabel}).`,
        Boolean(sameAmount && sameLeg),
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
        70,
        `Aynı cari ve aynı tutar nedeniyle şüpheli benzerlik (${previousRowLabel}).`,
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
        62,
        `Aynı tutar ve aynı karşı hesap ile ${previousRowLabel} eşleşiyor.`,
        false,
        "same-amount-counter"
      )
    );
  }

  if (sameAmount && similarity >= 0.85) {
    signals.push(
      createSignal(
        sameDate ? 75 : nearDate ? 68 : 58,
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
        nearDate ? 52 : 40,
        `Benzer açıklama ve aynı tutar nedeniyle şüpheli kayıt (${previousRowLabel}).`,
        false,
        "same-amount-moderate-desc"
      )
    );
  } else if (nearDate && sameAmount && similarity >= 0.55) {
    signals.push(
      createSignal(
        35 + Math.round(similarity * 15),
        `Yakın tarihte (${dayLabel}) aynı tutar ve benzer açıklama (${previousRowLabel}).`,
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
    sourceMovementId: getSourceMovementId(row),
    hesapKodu: row.hesapKodu || "",
    amount: getRowAmount(row),
    date: String(row.fisTarihi || row.evrakTarihi || ""),
    lineRole: getLineRole(row),
    criticalKey: buildCriticalDuplicateKey(row),
    riskScore: 0,
    riskLevel: MUKERRER_RISK_SEVIYE.DUSUK,
    isCritical: false,
    messages: [],
    signals: [],
  }));

  let expectedPairSignalCount = 0;
  const criticalKeyFirstIndex = new Map();

  for (let index = 0; index < sourceRows.length; index += 1) {
    const key = rowResults[index].criticalKey;
    const movementId = rowResults[index].sourceMovementId;
    if (key && movementId && !key.startsWith("|")) {
      if (criticalKeyFirstIndex.has(key)) {
        const previousIndex = criticalKeyFirstIndex.get(key);
        const signal = createSignal(
          100,
          `Kritik mükerrer: aynı hareket/hesap/yön/tutar tekrarı (${previousIndex + 1}. satır).`,
          true,
          "critical-same-leg"
        );
        rowResults[index].signals = mergeRowSignals(rowResults[index].signals, [signal]);
      } else {
        criticalKeyFirstIndex.set(key, index);
      }
    }

    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const signals = compareDuplicateRows(
        sourceRows[index],
        sourceRows[previousIndex],
        index,
        previousIndex
      );

      if (!signals.length) continue;

      for (const signal of signals) {
        if (signal.type === "expected-double-entry" || signal.type === "same-movement-split") {
          expectedPairSignalCount += 1;
          continue;
        }
        rowResults[index].signals = mergeRowSignals(rowResults[index].signals, [signal]);
      }
    }

    const actionable = rowResults[index].signals.filter(
      (signal) =>
        signal.type !== "expected-double-entry" && signal.type !== "same-movement-split"
    );
    const bestSignal = actionable.reduce(
      (best, signal) => (!best || signal.score > best.score ? signal : best),
      null
    );

    if (bestSignal) {
      rowResults[index].riskScore = bestSignal.score;
      rowResults[index].isCritical = actionable.some((signal) => signal.critical);
      rowResults[index].riskLevel = resolveRiskLevel(
        rowResults[index].riskScore,
        rowResults[index].isCritical
      );
      rowResults[index].messages = actionable.map((signal) => signal.message);
    }
  }

  const criticalRows = rowResults.filter((row) => row.isCritical);
  const criticalCount = criticalRows.length;
  const highCount = rowResults.filter(
    (row) => !row.isCritical && row.riskScore >= 70
  ).length;
  const mediumCount = rowResults.filter(
    (row) => !row.isCritical && row.riskScore >= 31 && row.riskScore < 70
  ).length;
  const lowCount = rowResults.filter((row) => row.riskScore < 31).length;
  const suspiciousCount = highCount + mediumCount;
  const expectedDoubleEntryPairs = Math.floor(expectedPairSignalCount);

  return {
    rows: rowResults,
    byRowId: new Map(rowResults.filter((row) => row.rowId).map((row) => [row.rowId, row])),
    criticalRows: criticalRows.map((row) => ({
      rowIndex: row.rowIndex,
      fisNo: row.fisNo,
      sourceMovementId: row.sourceMovementId,
      date: row.date,
      amount: row.amount,
      hesapKodu: row.hesapKodu,
      lineRole: row.lineRole,
      reason: row.messages[0] || "Kritik mükerrer",
    })),
    summary: {
      totalRows: rowResults.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      suspiciousCount,
      expectedDoubleEntryPairs,
      hasCritical: criticalCount > 0,
      hasHighRisk: highCount > 0 || criticalCount > 0,
      hasMediumRisk: mediumCount > 0,
      reportLine: `Kritik gerçek mükerrer: ${criticalCount} · Şüpheli benzer kayıt: ${suspiciousCount} · Beklenen borç/alacak çiftleri: ${expectedDoubleEntryPairs}`,
    },
  };
}
