/**
 * Salt okunur bileşik fiş ayrıntısı (MULTI_COUNTERPART presentation).
 * Motor sayaçlarına / otomatik seçime dokunmaz — yalnız presentation.
 */
import {
  BORC_ALACAK_TOLERANCE,
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_KAYNAK,
} from "@/src/config/eDefterKontrolDefaults";

function compactText(value = "") {
  return String(value ?? "").trim();
}

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function isZeroLeg(borc, alacak) {
  return (
    Math.abs(borc) <= BORC_ALACAK_TOLERANCE && Math.abs(alacak) <= BORC_ALACAK_TOLERANCE
  );
}

function rowSide(borc, alacak) {
  if (borc > BORC_ALACAK_TOLERANCE && alacak <= BORC_ALACAK_TOLERANCE) {
    return { yon: "BORÇ", isDebit: true, isCredit: false };
  }
  if (alacak > BORC_ALACAK_TOLERANCE && borc <= BORC_ALACAK_TOLERANCE) {
    return { yon: "ALACAK", isDebit: false, isCredit: true };
  }
  if (isZeroLeg(borc, alacak)) {
    return { yon: "", isDebit: false, isCredit: false, zero: true };
  }
  return { yon: "", isDebit: false, isCredit: false, mixed: true };
}

function isLedgerKaynak(kaynak = "") {
  const k = String(kaynak || "").toLowerCase();
  return (
    k === E_DEFTER_KAYNAK.MUAVIN ||
    k === E_DEFTER_KAYNAK.YEVMIYE ||
    k === E_DEFTER_KAYNAK.YEVMIYE_XML ||
    k.includes("muavin") ||
    k.includes("yevmiye")
  );
}

function isYevmiyeKaynak(kaynak = "") {
  const k = String(kaynak || "").toLowerCase();
  return k === E_DEFTER_KAYNAK.YEVMIYE || k === E_DEFTER_KAYNAK.YEVMIYE_XML || k.includes("yevmiye");
}

/** Modal banner — N birlikte çalışan karşı hesap. */
export function multiCounterpartReasonTr(candidateCount = 0) {
  const n = Math.max(0, Number(candidateCount) || 0);
  return `Bu hesap satırı karşı yöndeki ${n} farklı hesapla birlikte çalışmıştır.`;
}

/** Modal notu — bileşik fiş normaldir. */
export function multiCounterpartNormalNoteTr() {
  return "Bu durum çok satırlı muhasebe fişlerinde normaldir ve tek başına hata oluşturmaz.";
}

/**
 * Modal gösterim sırası: BORÇ → ALACAK → bilinmeyen/sıfır.
 * Aynı yön içinde kaynak sıra korunur (stable).
 */
export function sideRankForDisplay(yon = "") {
  if (yon === "BORÇ") return 0;
  if (yon === "ALACAK") return 1;
  return 2;
}

/**
 * Presentation-only sıralama. Girdi dizisini mutate etmez.
 */
export function sortMultiCounterpartLinesForDisplay(lines = []) {
  const source = Array.isArray(lines) ? lines : [];
  return source
    .map((line, sourceIndex) => ({ line, sourceIndex }))
    .sort((left, right) => {
      const rankDiff = sideRankForDisplay(left.line?.yon) - sideRankForDisplay(right.line?.yon);
      if (rankDiff !== 0) return rankDiff;
      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ line }) => line);
}

/**
 * Fiş satırlarını seç: yevmiye varsa onu kullan (tam fiş), yoksa muavin.
 * ledgerRows dizisini mutate etmez.
 */
export function selectVoucherRowsForMultiDetail(fisNo = "", ledgerRows = []) {
  const needle = compactText(fisNo);
  if (!needle) return [];
  const matched = (Array.isArray(ledgerRows) ? ledgerRows : []).filter((row) => {
    if (!row || !isLedgerKaynak(row.kaynak)) return false;
    if (String(row.kaynak || "").toLowerCase() === E_DEFTER_KAYNAK.MIZAN) return false;
    return compactText(row.fisNo) === needle;
  });
  const yevmiye = matched.filter((row) => isYevmiyeKaynak(row.kaynak));
  return yevmiye.length ? yevmiye : matched;
}

/**
 * Motorla aynı fail-closed mantık: karşı yönün benzersiz kodları (self hariç).
 * Otomatik tek hesap seçmez. Kod sırası localeCompare (önceki aday sırası).
 */
export function collectOppositeCandidateCodes(voucherRows = []) {
  const debitCodes = new Set();
  const creditCodes = new Set();

  for (const row of voucherRows) {
    const borc = roundMoney(row.borc);
    const alacak = roundMoney(row.alacak);
    const side = rowSide(borc, alacak);
    const code = compactText(row.hesapKodu);
    if (!code || side.zero || side.mixed) continue;
    if (side.isDebit) debitCodes.add(code);
    if (side.isCredit) creditCodes.add(code);
  }

  let maxOpposite = 0;
  const candidateUnion = new Set();

  for (const row of voucherRows) {
    const borc = roundMoney(row.borc);
    const alacak = roundMoney(row.alacak);
    const side = rowSide(borc, alacak);
    const selfCode = compactText(row.hesapKodu);
    if (!selfCode || side.zero || side.mixed) continue;

    const opposite = [
      ...(side.isDebit ? creditCodes : side.isCredit ? debitCodes : []),
    ].filter((code) => code !== selfCode);
    const unique = [...new Set(opposite)];
    if (unique.length > 1) {
      maxOpposite = Math.max(maxOpposite, unique.length);
      for (const code of unique) candidateUnion.add(code);
    }
  }

  const candidates = [...candidateUnion].sort((a, b) => a.localeCompare(b, "tr"));
  return {
    candidates,
    candidateCount: maxOpposite || candidates.length,
    debitCodes: [...debitCodes].sort((a, b) => a.localeCompare(b, "tr")),
    creditCodes: [...creditCodes].sort((a, b) => a.localeCompare(b, "tr")),
  };
}

/**
 * Aday kod sırasını koruyarak hesap adı + tutar zenginleştirir.
 * voucherRows / candidates mutate edilmez.
 */
export function buildCounterpartAccountDetails(candidateCodes = [], voucherRows = []) {
  const byCode = new Map();
  for (const row of Array.isArray(voucherRows) ? voucherRows : []) {
    const code = compactText(row.hesapKodu);
    if (!code || byCode.has(code)) continue;
    const borc = roundMoney(row.borc);
    const alacak = roundMoney(row.alacak);
    const side = rowSide(borc, alacak);
    byCode.set(code, {
      hesapKodu: code,
      hesapAdi: compactText(row.hesapAdi || row.accountName || ""),
      yon: side.yon,
      borc,
      alacak,
    });
  }

  return (Array.isArray(candidateCodes) ? candidateCodes : []).map((code) => {
    const found = byCode.get(compactText(code));
    if (found) return { ...found };
    return {
      hesapKodu: compactText(code),
      hesapAdi: "",
      yon: "",
      borc: 0,
      alacak: 0,
    };
  });
}

/**
 * Presentation grubuna eklenecek clone-safe fiş ayrıntısı.
 * ledgerRows mutate edilmez; satır sırası yalnız gösterim içindir.
 */
export function buildMultiCounterpartVoucherDetail({
  fisNo = "",
  tarih = "",
  ledgerRows = [],
  multiFindingItems = [],
} = {}) {
  const voucherRows = selectVoucherRowsForMultiDetail(fisNo, ledgerRows);
  const multiCodes = new Set(
    (Array.isArray(multiFindingItems) ? multiFindingItems : [])
      .map((item) => compactText(item.hesapKodu))
      .filter(Boolean)
  );

  const { candidates, candidateCount } = collectOppositeCandidateCodes(voucherRows);
  const counterpartAccounts = buildCounterpartAccountDetails(candidates, voucherRows);

  const mapped = voucherRows.map((row, index) => {
    const borc = roundMoney(row.borc);
    const alacak = roundMoney(row.alacak);
    const side = rowSide(borc, alacak);
    const hesapKodu = compactText(row.hesapKodu);
    const multiFromIssue = (row.issueDetails || []).some(
      (issue) => issue?.code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART
    );
    return {
      id: compactText(row.id) || `${hesapKodu}|${index}`,
      hesapKodu,
      hesapAdi: compactText(row.hesapAdi || row.accountName || ""),
      yon: side.yon,
      borc,
      alacak,
      multiAffected: multiFromIssue || multiCodes.has(hesapKodu),
      sourceIndex: index,
    };
  });

  const lines = sortMultiCounterpartLinesForDisplay(mapped);

  const resolvedTarih =
    compactText(tarih) ||
    compactText(voucherRows[0]?.tarih) ||
    compactText(multiFindingItems[0]?.tarih);

  return {
    fisNo: compactText(fisNo),
    tarih: resolvedTarih,
    lineCount: lines.length,
    lines,
    candidates,
    counterpartAccounts,
    candidateCount,
    reasonTr: multiCounterpartReasonTr(candidateCount),
    normalNoteTr: multiCounterpartNormalNoteTr(),
  };
}
