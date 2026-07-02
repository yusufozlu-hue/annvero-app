import { descriptionSimilarity } from "@/src/utils/bankaMutabakat";
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { getLucaAktarimMatchMemoryBoost } from "@/src/utils/lucaAktarimMatchMemory";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import {
  finalizeStandardLucaRow,
  LUCA_EXPORT_HEADERS,
} from "@/src/utils/standardLucaRow";
import { normalizeParserText } from "@/src/utils/textNormalize";

export const LUCA_AKTARIM_DURUM = {
  TAM_ESLESTI: "Tam eşleşti",
  OLASI_ESLESTI: "Olası eşleşme",
  ANNVERODA_VAR: "ANNVERO'da var, Luca'da yok",
  LUCADA_VAR: "Luca'da var, ANNVERO'da yok",
  TUTAR_FARKI: "Tutar farkı",
  TARIH_FARKI: "Tarih farkı",
  ACIKLAMA_FARKI: "Açıklama farkı",
  HESAP_FARKI: "Hesap kodu farkı",
  YON_FARKI: "Borç/alacak yönü farkı",
  MUKERRER: "Mükerrer aktarım riski",
  SATIR_EKSIK: "Satır eksikliği",
};

export const LUCA_AKTARIM_GRUP = {
  TAM_ESLESEN: "Tam eşleşenler",
  OLASI_ESLESEN: "Olası eşleşenler",
  ANNVERODA_VAR: "ANNVERO'da var Luca'da yok",
  LUCADA_VAR: "Luca'da var ANNVERO'da yok",
  TUTAR_FARKI: "Tutar farkı olanlar",
  TARIH_FARKI: "Tarih farkı olanlar",
  HESAP_FARKI: "Hesap kodu farkı olanlar",
  MUKERRER: "Mükerrer aktarım riski olanlar",
};

export const LUCA_GUVEN_ETIKET = {
  GUCLU: "Güçlü eşleşme",
  OLASI: "Olası eşleşme",
  KONTROL: "Kontrol edilmeli",
  ESLESMEDI: "Eşleşmedi",
};

function compactText(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function findLucaHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return (
      text.includes("FIS NO") &&
      (text.includes("HESAP") || text.includes("BORC") || text.includes("ALACAK"))
    );
  });
}

function getLucaCell(row, headers, names) {
  const list = Array.isArray(names) ? names : [names];

  for (const name of list) {
    const wanted = compactText(name);
    const index = headers.findIndex((header) => {
      const current = compactText(header);
      return current === wanted || current.includes(wanted);
    });

    if (index >= 0) return row[index];
  }

  return "";
}

function normalizeTransferDate(value) {
  const parsed = parseDateTR(value);
  return parsed ? formatDateTR(parsed) : String(value || "").trim();
}

function getRowDescription(row = {}) {
  return String(row.detayAciklama || row.fisAciklama || row.aciklama || "").trim();
}

function getRowAmounts(row = {}) {
  const borc = parseMoneyTR(row.borc);
  const alacak = parseMoneyTR(row.alacak);
  const amount = borc > 0 ? borc : alacak;
  const direction = borc > 0 ? "BORC" : alacak > 0 ? "ALACAK" : "";
  return { borc, alacak, amount, direction };
}

function normalizeAccountCode(value = "") {
  return compactText(value).replace(/\./g, "");
}

function daysBetweenDates(left, right) {
  const dateLeft = parseDateTR(left);
  const dateRight = parseDateTR(right);
  if (!dateLeft || !dateRight) return 999;
  return Math.abs(Math.round((dateLeft.getTime() - dateRight.getTime()) / 86400000));
}

function resolveGuvenEtiketi(score) {
  if (score >= 90) return LUCA_GUVEN_ETIKET.GUCLU;
  if (score >= 70) return LUCA_GUVEN_ETIKET.OLASI;
  if (score >= 40) return LUCA_GUVEN_ETIKET.KONTROL;
  return LUCA_GUVEN_ETIKET.ESLESMEDI;
}

function resolveRiskSeviyesi(durum) {
  if (
    [
      LUCA_AKTARIM_DURUM.ANNVERODA_VAR,
      LUCA_AKTARIM_DURUM.LUCADA_VAR,
      LUCA_AKTARIM_DURUM.TUTAR_FARKI,
      LUCA_AKTARIM_DURUM.YON_FARKI,
      LUCA_AKTARIM_DURUM.HESAP_FARKI,
    ].includes(durum)
  ) {
    return "Yüksek";
  }

  if (
    [
      LUCA_AKTARIM_DURUM.TARIH_FARKI,
      LUCA_AKTARIM_DURUM.ACIKLAMA_FARKI,
      LUCA_AKTARIM_DURUM.MUKERRER,
      LUCA_AKTARIM_DURUM.OLASI_ESLESTI,
      LUCA_AKTARIM_DURUM.SATIR_EKSIK,
    ].includes(durum)
  ) {
    return "Orta";
  }

  return "Düşük";
}

function resolveLucaAktarimGrup(row = {}) {
  const durum = row.durum;
  const score = row.guvenSkoru || 0;

  if (durum === LUCA_AKTARIM_DURUM.TAM_ESLESTI || (row.isMatched && score >= 90)) {
    return LUCA_AKTARIM_GRUP.TAM_ESLESEN;
  }

  if (
    durum === LUCA_AKTARIM_DURUM.OLASI_ESLESTI ||
    row.needsManualApproval ||
    (score >= 70 && score < 90 && row.annveroRow && row.lucaRow)
  ) {
    return LUCA_AKTARIM_GRUP.OLASI_ESLESEN;
  }

  if (durum === LUCA_AKTARIM_DURUM.ANNVERODA_VAR || durum === LUCA_AKTARIM_DURUM.SATIR_EKSIK) {
    return LUCA_AKTARIM_GRUP.ANNVERODA_VAR;
  }

  if (durum === LUCA_AKTARIM_DURUM.LUCADA_VAR) {
    return LUCA_AKTARIM_GRUP.LUCADA_VAR;
  }

  if (
    [
      LUCA_AKTARIM_DURUM.TUTAR_FARKI,
      LUCA_AKTARIM_DURUM.YON_FARKI,
    ].includes(durum)
  ) {
    return LUCA_AKTARIM_GRUP.TUTAR_FARKI;
  }

  if (durum === LUCA_AKTARIM_DURUM.TARIH_FARKI) {
    return LUCA_AKTARIM_GRUP.TARIH_FARKI;
  }

  if (durum === LUCA_AKTARIM_DURUM.HESAP_FARKI) {
    return LUCA_AKTARIM_GRUP.HESAP_FARKI;
  }

  if (durum === LUCA_AKTARIM_DURUM.MUKERRER) {
    return LUCA_AKTARIM_GRUP.MUKERRER;
  }

  if (score >= 40 && score < 70 && row.annveroRow && row.lucaRow) {
    return LUCA_AKTARIM_GRUP.OLASI_ESLESEN;
  }

  return LUCA_AKTARIM_GRUP.TAM_ESLESEN;
}

export function parseLucaTransferExcelSheet(sheetRows = [], source = "ANNVERO") {
  if (!sheetRows?.length) return [];

  const headerIndex = findLucaHeaderIndex(sheetRows);
  if (headerIndex < 0) return [];

  const headers = sheetRows[headerIndex];
  const dataRows = sheetRows.slice(headerIndex + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const fisNo = getLucaCell(row, headers, ["FİŞ NO", "FIS NO", "FISNO"]);
      const fisTarihi = getLucaCell(row, headers, ["FİŞ TARİHİ", "FIS TARIHI", "FISTARIHI"]);
      const fisAciklama = getLucaCell(row, headers, ["FİŞ AÇIKLAMA", "FIS ACIKLAMA"]);
      const hesapKodu = getLucaCell(row, headers, ["HESAP KODU", "HESAPKODU", "HESAP"]);
      const evrakNo = getLucaCell(row, headers, ["EVRAK NO", "BELGE NO", "DEKONT"]);
      const evrakTarihi = getLucaCell(row, headers, ["EVRAK TARİHİ", "EVRAK TARIHI"]);
      const detayAciklama = getLucaCell(row, headers, [
        "DETAY AÇIKLAMA",
        "DETAY ACIKLAMA",
        "AÇIKLAMA",
        "ACIKLAMA",
      ]);
      const borc = getLucaCell(row, headers, ["BORÇ", "BORC"]);
      const alacak = getLucaCell(row, headers, ["ALACAK"]);
      const belgeTuru = getLucaCell(row, headers, ["BELGE TÜRÜ", "BELGE TURU"]);

      const { amount, direction } = getRowAmounts({ borc, alacak });
      if (!fisTarihi || !hesapKodu || amount <= 0) return null;

      const finalized = finalizeStandardLucaRow({
        fisNo,
        fisTarihi,
        fisAciklama,
        hesapKodu,
        evrakNo,
        evrakTarihi,
        detayAciklama,
        borc,
        alacak,
        belgeTuru,
      });

      return {
        ...finalized,
        id: `${source.toLowerCase()}-${index + 1}`,
        kaynak: source,
        tutar: amount,
        yon: direction,
      };
    })
    .filter(Boolean);
}

function scoreLucaTransferPair(annveroRow, lucaRow, context = {}) {
  const annveroAmounts = getRowAmounts(annveroRow);
  const lucaAmounts = getRowAmounts(lucaRow);
  const sameDirection = annveroAmounts.direction === lucaAmounts.direction;
  const amountDiff = Math.abs(annveroAmounts.amount - lucaAmounts.amount);
  const sameAmount = amountDiff <= 0.01;
  const sameDate =
    normalizeTransferDate(annveroRow.fisTarihi) === normalizeTransferDate(lucaRow.fisTarihi);
  const dayDiff = daysBetweenDates(annveroRow.fisTarihi, lucaRow.fisTarihi);
  const sameAccount =
    normalizeAccountCode(annveroRow.hesapKodu) === normalizeAccountCode(lucaRow.hesapKodu);
  const similarity = descriptionSimilarity(
    getRowDescription(annveroRow),
    getRowDescription(lucaRow)
  );
  const sameFisNo =
    String(annveroRow.fisNo || "").trim() !== "" &&
    String(annveroRow.fisNo || "").trim() === String(lucaRow.fisNo || "").trim();
  const sameBelgeTuru =
    String(annveroRow.belgeTuru || "").trim() !== "" &&
    compactText(annveroRow.belgeTuru) === compactText(lucaRow.belgeTuru);
  const memoryBoost = getLucaAktarimMatchMemoryBoost(annveroRow, lucaRow, context);

  let score = 0;
  let method = "";

  if (!sameDirection && sameAmount) {
    score = 55;
    method = "tutar eşleşti yön farklı";
  } else if (sameDate && sameAccount && sameAmount && similarity >= 0.45) {
    score = 96 + Math.round(similarity * 4);
    method = "tarih+hesap+tutar+açıklama";
  } else if (sameFisNo && sameAccount && sameAmount) {
    score = 94;
    method = "fiş no+hesap+tutar";
  } else if (sameAccount && sameAmount && dayDiff <= 3 && similarity >= 0.35) {
    score = 82 + Math.round(similarity * 8) - dayDiff * 2;
    method = "hesap+tutar+yakın tarih";
  } else if (sameAmount && sameDate && similarity >= 0.55) {
    score = 78 + Math.round(similarity * 10);
    method = "tarih+tutar+açıklama";
  } else if (sameFisNo && sameAmount && similarity >= 0.4) {
    score = 76 + Math.round(similarity * 8);
    method = "fiş no+tutar";
  } else if (sameAccount && sameAmount && similarity >= 0.5) {
    score = 74 + Math.round(similarity * 8);
    method = "hesap+tutar+benzer açıklama";
  } else if (!sameAmount && sameAccount && sameDate && similarity >= 0.45) {
    score = 48 + Math.round(similarity * 15);
    method = "hesap+tarih benzer";
  }

  if (sameBelgeTuru) score += 4;
  score += memoryBoost;
  score = Math.min(100, Math.max(0, Math.round(score)));

  if (score < 40) return null;

  return {
    score,
    method: method || "benzerlik analizi",
    similarity,
    dayDiff,
    amountDiff,
    sameAmount,
    sameDate,
    sameAccount,
    sameDirection,
    sameFisNo,
    sameBelgeTuru,
    memoryBoost,
  };
}

function removeAt(list, index) {
  return list.filter((_, itemIndex) => itemIndex !== index);
}

function matchLucaTransferLists(annveroRows = [], lucaRows = [], context = {}) {
  let unmatchedAnnvero = annveroRows.map((row, index) => ({ ...row, _index: index }));
  let unmatchedLuca = lucaRows.map((row, index) => ({ ...row, _index: index }));
  const pairs = [];
  const candidates = [];

  const tryPair = (annveroIndex, lucaIndex, method, score, options = {}) => {
    const annvero = unmatchedAnnvero[annveroIndex];
    const luca = unmatchedLuca[lucaIndex];
    if (!annvero || !luca) return false;

    pairs.push({
      annvero,
      luca,
      method,
      score,
      needsManualApproval: options.needsManualApproval === true,
      matchMeta: options.matchMeta || null,
    });
    unmatchedAnnvero = removeAt(unmatchedAnnvero, annveroIndex);
    unmatchedLuca = removeAt(unmatchedLuca, lucaIndex);
    return true;
  };

  const findBest = (minScore, options = {}) => {
    let best = null;

    unmatchedAnnvero.forEach((annvero, annveroIndex) => {
      unmatchedLuca.forEach((luca, lucaIndex) => {
        const result = scoreLucaTransferPair(annvero, luca, context);
        if (!result || result.score < minScore) return;

        if (!best || result.score > best.score) {
          best = {
            annveroIndex,
            lucaIndex,
            ...result,
            needsManualApproval: options.needsManualApproval === true,
          };
        }
      });
    });

    if (!best) return false;

    return tryPair(
      best.annveroIndex,
      best.lucaIndex,
      best.method,
      best.score,
      {
        needsManualApproval: best.needsManualApproval,
        matchMeta: best,
      }
    );
  };

  while (findBest(90));
  while (findBest(70, { needsManualApproval: true }));

  unmatchedAnnvero.forEach((annvero) => {
    let bestCandidate = null;

    unmatchedLuca.forEach((luca) => {
      const result = scoreLucaTransferPair(annvero, luca, context);
      if (!result || result.score < 40 || result.score >= 70) return;

      if (!bestCandidate || result.score > bestCandidate.score) {
        bestCandidate = { annvero, luca, ...result };
      }
    });

    if (bestCandidate) candidates.push(bestCandidate);
  });

  return { pairs, unmatchedAnnvero, unmatchedLuca, candidates };
}

function buildTransferKey(row) {
  return [
    compactText(normalizeTransferDate(row.fisTarihi)),
    normalizeAccountCode(row.hesapKodu),
    getRowAmounts(row).amount.toFixed(2),
    compactText(getRowDescription(row)),
  ].join("|");
}

function detectDuplicateRows(rows) {
  const seen = new Map();
  const duplicates = new Set();

  rows.forEach((row, index) => {
    const key = buildTransferKey(row);
    if (!key.replace(/\|/g, "")) return;

    if (seen.has(key)) {
      duplicates.add(index);
      duplicates.add(seen.get(key));
    } else {
      seen.set(key, index);
    }
  });

  return duplicates;
}

function buildResultRow(base) {
  const row = {
    id: base.id,
    durum: base.durum,
    grup: base.grup || "",
    annveroFisNo: base.annveroFisNo ?? base.annveroRow?.fisNo ?? "",
    lucaFisNo: base.lucaFisNo ?? base.lucaRow?.fisNo ?? "",
    annveroTarihi: base.annveroTarihi ?? base.annveroRow?.fisTarihi ?? "",
    lucaTarihi: base.lucaTarihi ?? base.lucaRow?.fisTarihi ?? "",
    annveroHesap: base.annveroHesap ?? base.annveroRow?.hesapKodu ?? "",
    lucaHesap: base.lucaHesap ?? base.lucaRow?.hesapKodu ?? "",
    annveroAciklama: base.annveroAciklama ?? getRowDescription(base.annveroRow),
    lucaAciklama: base.lucaAciklama ?? getRowDescription(base.lucaRow),
    annveroTutari: base.annveroTutari ?? 0,
    lucaTutari: base.lucaTutari ?? 0,
    fark: base.fark ?? 0,
    guvenSkoru: base.guvenSkoru ?? 0,
    guvenEtiketi: base.guvenEtiketi || resolveGuvenEtiketi(base.guvenSkoru ?? 0),
    aciklamaBenzerligi: base.aciklamaBenzerligi ?? 0,
    riskSeviyesi: resolveRiskSeviyesi(base.durum),
    oneri: base.oneri || "",
    uyariListesi: base.uyariListesi || [],
    eslesmeYontemi: base.eslesmeYontemi || "",
    needsManualApproval: Boolean(base.needsManualApproval),
    manualApproved: Boolean(base.manualApproved),
    isError: base.isError !== false,
    isMatched: base.isMatched === true,
    isDifference: Boolean(base.isDifference),
    isMissingTransfer: Boolean(base.isMissingTransfer),
    annveroRow: base.annveroRow || null,
    lucaRow: base.lucaRow || null,
  };

  row.grup = row.grup || resolveLucaAktarimGrup(row);
  return row;
}

function classifyPair({ annvero, luca, score, needsManualApproval, matchMeta }) {
  const annveroAmounts = getRowAmounts(annvero);
  const lucaAmounts = getRowAmounts(luca);
  const amountDiff = Math.abs(annveroAmounts.amount - lucaAmounts.amount);
  const dayDiff = matchMeta?.dayDiff ?? daysBetweenDates(annvero.fisTarihi, luca.fisTarihi);
  const similarity =
    matchMeta?.similarity ?? descriptionSimilarity(getRowDescription(annvero), getRowDescription(luca));
  const sameAccount =
    normalizeAccountCode(annvero.hesapKodu) === normalizeAccountCode(luca.hesapKodu);
  const uyariListesi = [];

  let durum = LUCA_AKTARIM_DURUM.TAM_ESLESTI;
  let oneri = "ANNVERO satırı Luca kaydı ile tam eşleşti.";
  let isError = false;
  let isMatched = true;
  let isDifference = false;
  let pendingApproval = needsManualApproval;

  if (pendingApproval && score < 90) {
    durum = LUCA_AKTARIM_DURUM.OLASI_ESLESTI;
    oneri = "Olası aktarım eşleşmesi — manuel onay önerilir.";
    isError = true;
    isMatched = false;
  } else if (!matchMeta?.sameDirection && annveroAmounts.amount > 0 && amountDiff <= 0.01) {
    durum = LUCA_AKTARIM_DURUM.YON_FARKI;
    oneri = "Tutar aynı ancak borç/alacak yönü farklı.";
    uyariListesi.push("Borç/alacak yönü farkı tespit edildi.");
    isError = true;
    isMatched = false;
    isDifference = true;
  } else if (amountDiff > 0.01) {
    durum = LUCA_AKTARIM_DURUM.TUTAR_FARKI;
    oneri = "Tutar farkını kontrol edin.";
    uyariListesi.push("Tutar farkı var.");
    isError = true;
    isMatched = false;
    isDifference = true;
  } else if (!sameAccount) {
    durum = LUCA_AKTARIM_DURUM.HESAP_FARKI;
    oneri = "Hesap kodu farkını kontrol edin.";
    uyariListesi.push("Hesap kodu farkı var.");
    isError = true;
    isMatched = false;
    isDifference = true;
  } else if (dayDiff > 0) {
    durum = LUCA_AKTARIM_DURUM.TARIH_FARKI;
    oneri = `${dayDiff} gün tarih farkı var.`;
    uyariListesi.push("Tarih farkı var.");
    isError = true;
    isMatched = false;
    isDifference = true;
  } else if (similarity < 0.7) {
    durum = LUCA_AKTARIM_DURUM.ACIKLAMA_FARKI;
    oneri = "Tutar ve tarih uyumlu; açıklamalar farklı.";
    uyariListesi.push("Açıklama farkı var.");
    isError = score < 90;
    isMatched = score >= 90;
    isDifference = score < 90;
  }

  return {
    durum,
    oneri,
    uyariListesi,
    isError,
    isMatched,
    isDifference,
    pendingApproval,
    similarity,
    dayDiff,
    amountDiff,
  };
}

export function runLucaAktarimKontrol({
  annveroRows = [],
  lucaRows = [],
  firmaId = "",
} = {}) {
  const matchContext = { firmaId, companyId: firmaId };
  const normalizedAnnvero = annveroRows.map((row, index) => ({
    ...row,
    id: row.id || `annvero-${index + 1}`,
    kaynak: "ANNVERO",
    fisTarihi: normalizeTransferDate(row.fisTarihi),
  }));
  const normalizedLuca = lucaRows.map((row, index) => ({
    ...row,
    id: row.id || `luca-${index + 1}`,
    kaynak: "LUCA",
    fisTarihi: normalizeTransferDate(row.fisTarihi),
  }));

  const { pairs, unmatchedAnnvero, unmatchedLuca, candidates } = matchLucaTransferLists(
    normalizedAnnvero,
    normalizedLuca,
    matchContext
  );

  const results = [];
  let resultIndex = 1;

  pairs.forEach(({ annvero, luca, method, score, needsManualApproval, matchMeta }) => {
    const classified = classifyPair({
      annvero,
      luca,
      score,
      needsManualApproval,
      matchMeta,
    });
    const annveroAmounts = getRowAmounts(annvero);
    const lucaAmounts = getRowAmounts(luca);

    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum: classified.durum,
        annveroFisNo: annvero.fisNo,
        lucaFisNo: luca.fisNo,
        annveroTarihi: annvero.fisTarihi,
        lucaTarihi: luca.fisTarihi,
        annveroHesap: annvero.hesapKodu,
        lucaHesap: luca.hesapKodu,
        annveroAciklama: getRowDescription(annvero),
        lucaAciklama: getRowDescription(luca),
        annveroTutari: annveroAmounts.amount,
        lucaTutari: lucaAmounts.amount,
        fark: Number((annveroAmounts.amount - lucaAmounts.amount).toFixed(2)),
        guvenSkoru: score,
        aciklamaBenzerligi: Number(classified.similarity.toFixed(2)),
        oneri: classified.oneri,
        uyariListesi: classified.uyariListesi,
        eslesmeYontemi: method,
        needsManualApproval: classified.pendingApproval,
        isError: classified.isError,
        isMatched: classified.isMatched,
        isDifference: classified.isDifference,
        annveroRow: annvero,
        lucaRow: luca,
      })
    );
  });

  const candidateAnnveroIds = new Set();
  const candidateLucaIds = new Set();

  candidates.forEach(({ annvero, luca, score, method, similarity, dayDiff }) => {
    candidateAnnveroIds.add(annvero.id);
    candidateLucaIds.add(luca.id);
    const annveroAmounts = getRowAmounts(annvero);
    const lucaAmounts = getRowAmounts(luca);

    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum: LUCA_AKTARIM_DURUM.OLASI_ESLESTI,
        annveroFisNo: annvero.fisNo,
        lucaFisNo: luca.fisNo,
        annveroTarihi: annvero.fisTarihi,
        lucaTarihi: luca.fisTarihi,
        annveroHesap: annvero.hesapKodu,
        lucaHesap: luca.hesapKodu,
        annveroAciklama: getRowDescription(annvero),
        lucaAciklama: getRowDescription(luca),
        annveroTutari: annveroAmounts.amount,
        lucaTutari: lucaAmounts.amount,
        fark: Number((annveroAmounts.amount - lucaAmounts.amount).toFixed(2)),
        guvenSkoru: score,
        aciklamaBenzerligi: Number(similarity.toFixed(2)),
        oneri:
          dayDiff > 0
            ? `${dayDiff} gün fark ile kontrol edilmeli eşleşme adayı.`
            : "Kontrol edilmeli aktarım eşleşme adayı.",
        eslesmeYontemi: method,
        needsManualApproval: true,
        isError: true,
        isMatched: false,
        annveroRow: annvero,
        lucaRow: luca,
      })
    );
  });

  const annveroDuplicateIndexes = detectDuplicateRows(normalizedAnnvero);
  const lucaDuplicateIndexes = detectDuplicateRows(normalizedLuca);
  const reservedAnnveroIds = new Set(candidateAnnveroIds);
  const reservedLucaIds = new Set(candidateLucaIds);

  unmatchedAnnvero.forEach((row) => {
    if (reservedAnnveroIds.has(row.id)) return;

    let durum = LUCA_AKTARIM_DURUM.ANNVERODA_VAR;
    let oneri = "ANNVERO'da üretilen satır Luca'da bulunamadı.";
    const uyariListesi = ["Satır eksikliği / eksik aktarım olabilir."];

    if (annveroDuplicateIndexes.has(row._index)) {
      durum = LUCA_AKTARIM_DURUM.MUKERRER;
      oneri = "ANNVERO tarafında mükerrer aktarım riski olabilir.";
      uyariListesi.push("Mükerrer aktarım riski.");
    }

    const amount = getRowAmounts(row).amount;

    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum,
        annveroFisNo: row.fisNo,
        annveroTarihi: row.fisTarihi,
        annveroHesap: row.hesapKodu,
        annveroAciklama: getRowDescription(row),
        annveroTutari: amount,
        lucaTutari: 0,
        fark: amount,
        oneri,
        uyariListesi,
        isError: true,
        isMatched: false,
        isMissingTransfer: true,
        annveroRow: row,
      })
    );
  });

  unmatchedLuca.forEach((row) => {
    if (reservedLucaIds.has(row.id)) return;

    let durum = LUCA_AKTARIM_DURUM.LUCADA_VAR;
    let oneri = "Luca'da kayıt var ancak ANNVERO çıktısında karşılığı yok.";
    const uyariListesi = ["Luca'da fazladan kayıt olabilir."];

    if (lucaDuplicateIndexes.has(row._index)) {
      durum = LUCA_AKTARIM_DURUM.MUKERRER;
      oneri = "Luca tarafında mükerrer aktarım riski olabilir.";
      uyariListesi.push("Mükerrer aktarım riski.");
    }

    const amount = getRowAmounts(row).amount;

    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum,
        lucaFisNo: row.fisNo,
        lucaTarihi: row.fisTarihi,
        lucaHesap: row.hesapKodu,
        lucaAciklama: getRowDescription(row),
        annveroTutari: 0,
        lucaTutari: amount,
        fark: -amount,
        oneri,
        uyariListesi,
        isError: true,
        isMatched: false,
        isMissingTransfer: true,
        lucaRow: row,
      })
    );
  });

  if (normalizedAnnvero.length !== normalizedLuca.length) {
    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum: LUCA_AKTARIM_DURUM.SATIR_EKSIK,
        oneri: `Satır sayısı farkı: ANNVERO ${normalizedAnnvero.length}, Luca ${normalizedLuca.length}.`,
        uyariListesi: ["Toplam satır sayıları eşit değil."],
        isError: true,
        isMatched: false,
        isMissingTransfer: true,
        isDifference: true,
      })
    );
  }

  const grouped = groupLucaAktarimRows(results);
  const summary = recalculateLucaAktarimSummary(results, grouped, {
    annveroCount: normalizedAnnvero.length,
    lucaCount: normalizedLuca.length,
  });

  return {
    rows: results,
    grouped,
    summary,
    headers: LUCA_EXPORT_HEADERS,
  };
}

export function groupLucaAktarimRows(rows = []) {
  const grouped = Object.fromEntries(
    Object.values(LUCA_AKTARIM_GRUP).map((label) => [label, []])
  );

  rows.forEach((row) => {
    const grup = row.grup || resolveLucaAktarimGrup(row);
    if (!grouped[grup]) grouped[grup] = [];
    grouped[grup].push({ ...row, grup });
  });

  return grouped;
}

export function approveLucaAktarimMatch(row) {
  if (!row?.annveroRow || !row?.lucaRow) return row;

  return buildResultRow({
    ...row,
    durum: LUCA_AKTARIM_DURUM.TAM_ESLESTI,
    guvenSkoru: Math.max(row.guvenSkoru || 0, 95),
    oneri: "Manuel onaylandı — aktarım eşleşmesi hafızaya alındı.",
    needsManualApproval: false,
    manualApproved: true,
    isError: false,
    isMatched: true,
    isDifference: false,
    grup: LUCA_AKTARIM_GRUP.TAM_ESLESEN,
  });
}

export function recalculateLucaAktarimSummary(rows = [], grouped = {}, baseSummary = {}) {
  return {
    ...baseSummary,
    tamEslesenCount: grouped[LUCA_AKTARIM_GRUP.TAM_ESLESEN]?.length || 0,
    olasiEslesenCount: grouped[LUCA_AKTARIM_GRUP.OLASI_ESLESEN]?.length || 0,
    eksikAktarimCount:
      (grouped[LUCA_AKTARIM_GRUP.ANNVERODA_VAR]?.length || 0) +
      (grouped[LUCA_AKTARIM_GRUP.LUCADA_VAR]?.length || 0),
    farkKayitCount:
      (grouped[LUCA_AKTARIM_GRUP.TUTAR_FARKI]?.length || 0) +
      (grouped[LUCA_AKTARIM_GRUP.TARIH_FARKI]?.length || 0) +
      (grouped[LUCA_AKTARIM_GRUP.HESAP_FARKI]?.length || 0),
    riskliKayitCount: grouped[LUCA_AKTARIM_GRUP.MUKERRER]?.length || 0,
    errorCount: rows.filter((row) => row.isError).length,
  };
}

export function filterLucaAktarimRows(
  rows = [],
  {
    group = "",
    differencesOnly = false,
    missingOnly = false,
    riskyOnly = false,
    hideMatched = false,
  } = {}
) {
  return rows.filter((row) => {
    if (group && row.grup !== group) return false;
    if (hideMatched && row.durum === LUCA_AKTARIM_DURUM.TAM_ESLESTI) return false;
    if (differencesOnly && !row.isDifference) return false;
    if (missingOnly && !row.isMissingTransfer) return false;
    if (riskyOnly) {
      const risky =
        row.riskSeviyesi === "Yüksek" ||
        row.grup === LUCA_AKTARIM_GRUP.MUKERRER ||
        row.needsManualApproval;
      if (!risky) return false;
    }
    return true;
  });
}

export function buildLucaAktarimExcelRows(analysis) {
  return (analysis?.rows || []).map((row) => ({
    Grup: row.grup,
    Durum: row.durum,
    "Güven Skoru": row.guvenSkoru,
    "Güven Etiketi": row.guvenEtiketi,
    "ANNVERO Fiş No": row.annveroFisNo,
    "Luca Fiş No": row.lucaFisNo,
    "ANNVERO Tarihi": row.annveroTarihi,
    "Luca Tarihi": row.lucaTarihi,
    "ANNVERO Hesap": row.annveroHesap,
    "Luca Hesap": row.lucaHesap,
    "ANNVERO Açıklama": row.annveroAciklama,
    "Luca Açıklama": row.lucaAciklama,
    "ANNVERO Tutarı": row.annveroTutari,
    "Luca Tutarı": row.lucaTutari,
    Fark: row.fark,
    "Açıklama Benzerliği": row.aciklamaBenzerligi,
    Risk: row.riskSeviyesi,
    Uyarılar: (row.uyariListesi || []).join(" | "),
    Öneri: row.oneri,
    "Eşleşme Yöntemi": row.eslesmeYontemi,
    "Manuel Onay": row.manualApproved ? "Evet" : row.needsManualApproval ? "Bekliyor" : "Hayır",
  }));
}

export function buildLucaAktarimSummarySheetRows(analysis, meta = {}) {
  const summary = analysis?.summary || {};
  return [
    {
      Firma: meta.firma || "-",
      "ANNVERO Satırı": summary.annveroCount || 0,
      "Luca Satırı": summary.lucaCount || 0,
      "Tam Eşleşen": summary.tamEslesenCount || 0,
      "Olası Eşleşen": summary.olasiEslesenCount || 0,
      "Eksik Aktarım": summary.eksikAktarimCount || 0,
      "Fark Olan": summary.farkKayitCount || 0,
      "Riskli Kayıt": summary.riskliKayitCount || 0,
    },
  ];
}
