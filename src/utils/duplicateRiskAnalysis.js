import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { normalizeParserText } from "@/src/utils/textNormalize";

export const MUKERRER_RISK_SEVIYE = {
  DUSUK: "Düşük",
  ORTA: "Orta",
  YUKSEK: "Yüksek",
  KRITIK: "Kritik",
};

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

/** Aynı gün + aynı tutar kovası içindeki şüpheli (kritik olmayan) sinyaller. */
function compareSuspiciousSameDayPair(currentRow, previousRow, previousIndex) {
  const signals = [];
  const currentDescription = getRowDescription(currentRow);
  const previousDescription = getRowDescription(previousRow);
  const similarity = descriptionSimilarity(currentDescription, previousDescription);
  const previousRowLabel = `${previousIndex + 1}. satır`;

  // Exact-triple asla kritik değil — yalnızca şüpheli
  if (similarity >= 0.99 && currentDescription && previousDescription) {
    signals.push(
      createSignal(
        88,
        `Şüpheli benzer kayıt: aynı tarih/tutar/açıklama (${previousRowLabel}). Farklı hareket olabilir.`,
        false,
        "suspicious-triple"
      )
    );
  }

  const currentCari = getCariName(currentRow);
  const previousCari = getCariName(previousRow);

  if (
    currentCari &&
    previousCari &&
    normalizeParserText(currentCari) === normalizeParserText(previousCari)
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

  if (currentKarsi && previousKarsi && currentKarsi === previousKarsi) {
    signals.push(
      createSignal(
        62,
        `Aynı tutar ve aynı karşı hesap ile ${previousRowLabel} eşleşiyor.`,
        false,
        "same-amount-counter"
      )
    );
  }

  if (similarity >= 0.85) {
    signals.push(
      createSignal(
        75,
        `Aynı tutar ve benzer açıklama ile ${previousRowLabel} kayıt var.`,
        false,
        "same-amount-similar-desc"
      )
    );
  } else if (similarity >= 0.72) {
    signals.push(
      createSignal(
        52,
        `Benzer açıklama ve aynı tutar nedeniyle şüpheli kayıt (${previousRowLabel}).`,
        false,
        "same-amount-moderate-desc"
      )
    );
  } else if (similarity >= 0.55) {
    signals.push(
      createSignal(
        35 + Math.round(similarity * 15),
        `Yakın tarihte (aynı gün) aynı tutar ve benzer açıklama (${previousRowLabel}).`,
        false,
        "near-date-similar"
      )
    );
  }

  return signals;
}

function shouldSkipDuplicatePair(left, right) {
  return isExpectedDoubleEntryPair(left, right) || isSameMovementDifferentLeg(left, right);
}

function finalizeRowResult(rowResult) {
  const actionable = rowResult.signals.filter(
    (signal) =>
      signal.type !== "expected-double-entry" && signal.type !== "same-movement-split"
  );
  const bestSignal = actionable.reduce(
    (best, signal) => (!best || signal.score > best.score ? signal : best),
    null
  );

  if (bestSignal) {
    rowResult.riskScore = bestSignal.score;
    rowResult.isCritical = actionable.some((signal) => signal.critical);
    rowResult.riskLevel = resolveRiskLevel(rowResult.riskScore, rowResult.isCritical);
    rowResult.messages = actionable.map((signal) => signal.message);
  }
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

  // 1) Kritik geçiş: criticalKey -> ilk indeks (O(n))
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
  }

  // 2) Beklenen çift taraflı fiş çiftleri (O(n) gruplama)
  const fisNoGroups = new Map();
  for (let index = 0; index < sourceRows.length; index += 1) {
    const fisNo = String(sourceRows[index].fisNo ?? "").trim();
    if (!fisNo) continue;
    if (!fisNoGroups.has(fisNo)) fisNoGroups.set(fisNo, { borc: 0, alacak: 0 });
    const role = getLineRole(sourceRows[index]);
    if (role === "borc") fisNoGroups.get(fisNo).borc += 1;
    else if (role === "alacak") fisNoGroups.get(fisNo).alacak += 1;
  }

  let expectedDoubleEntryPairs = 0;
  for (const group of fisNoGroups.values()) {
    if (group.borc > 0 && group.alacak > 0) {
      expectedDoubleEntryPairs += group.borc * group.alacak;
    }
  }

  // 3) Şüpheli geçiş: aynı gün + aynı tutar kovaları (O(n + bucket²))
  const amountDateBuckets = new Map();
  for (let index = 0; index < sourceRows.length; index += 1) {
    const amount = rowResults[index].amount;
    if (amount <= 0) continue;
    const normalizedDate = normalizeParserText(
      String(sourceRows[index].fisTarihi || sourceRows[index].evrakTarihi || "")
    );
    const bucketKey = `${amount.toFixed(2)}|${normalizedDate}`;
    if (!amountDateBuckets.has(bucketKey)) amountDateBuckets.set(bucketKey, []);
    amountDateBuckets.get(bucketKey).push(index);
  }

  for (const indices of amountDateBuckets.values()) {
    if (indices.length < 2) continue;
    for (let i = 1; i < indices.length; i += 1) {
      const index = indices[i];
      for (let j = 0; j < i; j += 1) {
        const previousIndex = indices[j];
        if (shouldSkipDuplicatePair(sourceRows[index], sourceRows[previousIndex])) {
          continue;
        }
        const signals = compareSuspiciousSameDayPair(
          sourceRows[index],
          sourceRows[previousIndex],
          previousIndex
        );
        if (signals.length) {
          rowResults[index].signals = mergeRowSignals(rowResults[index].signals, signals);
        }
      }
    }
  }

  // 4) Evrak kovası: aynı belge no
  const evrakBuckets = new Map();
  for (let index = 0; index < sourceRows.length; index += 1) {
    const evrak = getEvrakNo(sourceRows[index]);
    if (!evrak) continue;
    const key = normalizeEvrakNo(evrak);
    if (!key) continue;
    if (!evrakBuckets.has(key)) evrakBuckets.set(key, []);
    evrakBuckets.get(key).push(index);
  }

  for (const indices of evrakBuckets.values()) {
    if (indices.length < 2) continue;
    for (let i = 1; i < indices.length; i += 1) {
      const index = indices[i];
      const currentRow = sourceRows[index];
      const currentEvrak = getEvrakNo(currentRow);
      const currentAmount = getRowAmount(currentRow);
      const currentRole = getLineRole(currentRow);
      const currentHesap = normalizeParserText(currentRow.hesapKodu || "");

      for (let j = 0; j < i; j += 1) {
        const previousIndex = indices[j];
        const previousRow = sourceRows[previousIndex];
        if (shouldSkipDuplicatePair(currentRow, previousRow)) continue;

        const sameAmount = amountsEqual(currentAmount, getRowAmount(previousRow));
        const sameLeg =
          currentRole === getLineRole(previousRow) &&
          currentHesap === normalizeParserText(previousRow.hesapKodu || "");
        const previousRowLabel = `${previousIndex + 1}. satır`;
        const isCritical = Boolean(sameAmount && sameLeg);

        const signal = createSignal(
          isCritical ? 96 : sameAmount ? 78 : 60,
          isCritical
            ? `Kritik: aynı belge no "${currentEvrak}", tutar, hesap ve yön (${previousRowLabel}).`
            : `Aynı belge no "${currentEvrak}" daha önce kullanılmış olabilir (${previousRowLabel}).`,
          isCritical,
          "duplicate-evrak"
        );
        rowResults[index].signals = mergeRowSignals(rowResults[index].signals, [signal]);
      }
    }
  }

  for (const rowResult of rowResults) {
    finalizeRowResult(rowResult);
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
