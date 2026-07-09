import { parseGarantiEkstre } from "../../parsers/garantiParser";
import { parseVakifbankEkstre } from "../../parsers/vakifbankParser";
import { resolve102BankAccount } from "@/src/utils/companyCenter";
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { getMutabakatMatchMemoryBoost } from "@/src/utils/mutabakatMatchMemory";
import { finalizeStandardLucaRow, KAYNAK_TIPI } from "@/src/utils/standardLucaRow";
import { normalizeParserText } from "@/src/utils/textNormalize";

import { BANK_MUTABAKAT_OPTIONS } from "@/src/config/bankParserOptions";

export const BANK_OPTIONS = BANK_MUTABAKAT_OPTIONS;

export const MUTABAKAT_DURUM = {
  TAM_ESLESTI: "Tam eşleşti",
  ESLESTI: "Eşleşti",
  OLASI_ESLESTI: "Olası eşleşme",
  BANKADA_VAR: "Bankada var, muhasebede yok",
  MUAVINDE_VAR: "Muhasebede var, bankada yok",
  TUTAR_FARKI: "Tutar farkı",
  TARIH_FARKI: "Tarih farkı",
  ACIKLAMA_FARKI: "Açıklama farkı",
  ACIKLAMA_BENZER_TUTAR_FARKLI: "Açıklama benzer ama tutar farklı",
  MUKERRER: "Mükerrer kayıt",
  EKSIK_MASRAF: "Eksik banka masrafı",
  EKSIK_POS: "Eksik POS komisyonu",
  BSMV_MASRAF_FARKI: "BSMV/masraf farkı",
  POS_KOMISYON_FARKI: "POS komisyon farkı",
};

export const MUTABAKAT_GRUP = {
  TAM_ESLESEN: "Tam eşleşenler",
  OLASI_ESLESEN: "Olası eşleşenler",
  BANKADA_VAR: "Bankada var muhasebede yok",
  MUAVINDE_VAR: "Muhasebede var bankada yok",
  TUTAR_FARKI: "Tutar farkı olanlar",
  TARIH_FARKI: "Tarih farkı olanlar",
  MUKERRER: "Mükerrer riski olanlar",
};

export const GUVEN_ETIKET = {
  GUCLU: "Güçlü eşleşme",
  OLASI: "Olası eşleşme",
  KONTROL: "Kontrol edilmeli",
  ESLESMEDI: "Eşleşmedi",
};

const DEFAULT_102_BY_BANK = {
  TEB: "102.01.003",
  GARANTI: "102.01.001",
  VAKIFBANK: "102.01.004",
  KUVEYT: "102.01.005",
  ZIRAAT: "102.01.006",
  DIGER: "102",
};

const MASRAF_KEYWORDS = ["MASRAF", "KOMISYON", "KOMİSYON", "BSMV", "UCRET", "ÜCRET", "HAVALE UCRET"];
const POS_KEYWORDS = ["POS", "SANAL POS", "KART"];

function compactText(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function findHeaderRowIndex(rows) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return text.includes("TARIH") && text.includes("ACIKLAMA");
  });
}

function getCell(row, headers, names) {
  const list = Array.isArray(names) ? names : [names];

  for (const name of list) {
    const wanted = normalizeParserText(name).replace(/\s+/g, "");
    const index = headers.findIndex((header) =>
      normalizeParserText(header).replace(/\s+/g, "").includes(wanted)
    );

    if (index >= 0) return row[index];
  }

  return "";
}

function parseGenericBankEkstre(sheetRows, bankaAdi) {
  if (!sheetRows?.length) return [];

  const headerIndex = findHeaderRowIndex(sheetRows);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const tarih =
        getCell(row, headers, ["TARİH", "TARIH", "İŞLEM TARİHİ", "ISLEM TARIHI"]) ||
        row[0] ||
        "";

      const aciklama =
        getCell(row, headers, ["AÇIKLAMA", "ACIKLAMA", "İŞLEM", "ISLEM"]) ||
        row[1] ||
        "";

      const dekontNo =
        getCell(row, headers, ["DEKONT", "DEKONT NO", "FİŞ NO", "FIS NO", "İŞLEM NO", "ISLEM NO"]) ||
        "";

      let borc = parseMoneyTR(getCell(row, headers, ["BORÇ", "BORC", "ÇIKIŞ", "CIKIS"]));
      let alacak = parseMoneyTR(getCell(row, headers, ["ALACAK", "GİRİŞ", "GIRIS"]));
      let tutar = parseMoneyTR(getCell(row, headers, ["TUTAR", "İŞLEM TUTARI", "ISLEM TUTARI"]));

      if (!borc && !alacak && tutar) {
        if (tutar > 0) alacak = Math.abs(tutar);
        else borc = Math.abs(tutar);
      }

      if (!tutar) {
        tutar = alacak > 0 ? alacak : -borc;
      }

      const yon = tutar > 0 ? "GIRIS" : "CIKIS";

      if (!tarih || !aciklama || !tutar) return null;

      return {
        banka: bankaAdi,
        tarih,
        dekontNo: dekontNo || `${bankaAdi}-${index + 1}`,
        aciklama,
        borc: yon === "GIRIS" ? Math.abs(tutar) : 0,
        alacak: yon === "CIKIS" ? Math.abs(tutar) : 0,
        tutar,
        yon,
      };
    })
    .filter(Boolean);
}

export function parseBankEkstreSheet(sheetRows = [], bankId = "DIGER") {
  if (!sheetRows.length) return [];

  if (bankId === "GARANTI") {
    return parseGarantiEkstre(sheetRows).map((row) => ({
      ...row,
      banka: "GARANTI",
    }));
  }

  if (bankId === "VAKIFBANK") {
    return parseVakifbankEkstre(sheetRows).map((row) => ({
      ...row,
      banka: "VAKIFBANK",
    }));
  }

  return parseGenericBankEkstre(sheetRows, bankId);
}

function findMuavinHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return (
      text.includes("HESAP") &&
      (text.includes("BORC") || text.includes("ALACAK")) &&
      (text.includes("TARIH") || text.includes("ACIKLAMA"))
    );
  });
}

function getMuavinCell(row, headers, names) {
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

export function parseLuca102MuavinSheet(sheetRows = [], accountFilter = "") {
  if (!sheetRows.length) return [];

  const headerIndex = findMuavinHeaderIndex(sheetRows);
  if (headerIndex < 0) return [];

  const headers = sheetRows[headerIndex];
  const dataRows = sheetRows.slice(headerIndex + 1);
  const wantedAccount = compactText(accountFilter);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const hesapKodu = String(
        getMuavinCell(row, headers, ["HESAP KODU", "HESAPKODU", "HESAP"]) || ""
      ).trim();

      const compactAccount = compactText(hesapKodu);
      if (!compactAccount.startsWith("102")) return null;

      if (wantedAccount && !compactAccount.includes(wantedAccount.replace(/\./g, ""))) {
        if (compactAccount !== wantedAccount && !compactAccount.startsWith(wantedAccount)) {
          return null;
        }
      }

      const tarih =
        getMuavinCell(row, headers, ["FİŞ TARİHİ", "FIS TARIHI", "TARİH", "TARIH", "EVRAK TARİHİ"]) ||
        "";

      const aciklama = String(
        getMuavinCell(row, headers, [
          "DETAY AÇIKLAMA",
          "DETAY ACIKLAMA",
          "AÇIKLAMA",
          "ACIKLAMA",
          "FİŞ AÇIKLAMA",
          "FIS ACIKLAMA",
        ]) || ""
      ).trim();

      const borc = parseMoneyTR(getMuavinCell(row, headers, ["BORÇ", "BORC"]));
      const alacak = parseMoneyTR(getMuavinCell(row, headers, ["ALACAK"]));
      const evrakNo = String(
        getMuavinCell(row, headers, ["EVRAK NO", "BELGE NO", "DEKONT"]) || ""
      ).trim();
      const fisNo = getMuavinCell(row, headers, ["FİŞ NO", "FIS NO"]);

      if (!tarih || (!borc && !alacak)) return null;

      return {
        id: `muavin-${index + 1}`,
        fisNo,
        tarih,
        aciklama,
        hesapKodu,
        borc,
        alacak,
        evrakNo,
        tutar: borc > 0 ? borc : alacak,
        yon: borc > 0 ? "GIRIS" : "CIKIS",
      };
    })
    .filter(Boolean);
}

function normalizeMovementDate(value) {
  const parsed = parseDateTR(value);
  return parsed ? formatDateTR(parsed) : String(value || "").trim();
}

function getSignedAmount(row, side) {
  const amount = parseMoneyTR(row.tutar || row.borc || row.alacak);
  const yon =
    row.yon ||
    (parseMoneyTR(row.borc) > 0 ? "GIRIS" : parseMoneyTR(row.alacak) > 0 ? "CIKIS" : "");

  return {
    amount,
    direction: yon === "GIRIS" ? "IN" : "OUT",
  };
}

export function descriptionSimilarity(left = "", right = "") {
  const tokensLeft = new Set(
    normalizeParserText(left)
      .split(" ")
      .filter((token) => token.length > 2)
  );
  const tokensRight = new Set(
    normalizeParserText(right)
      .split(" ")
      .filter((token) => token.length > 2)
  );

  if (!tokensLeft.size || !tokensRight.size) return 0;

  let intersection = 0;
  tokensLeft.forEach((token) => {
    if (tokensRight.has(token)) intersection += 1;
  });

  return intersection / new Set([...tokensLeft, ...tokensRight]).size;
}

function daysBetweenDates(left, right) {
  const dateLeft = parseDateTR(left);
  const dateRight = parseDateTR(right);

  if (!dateLeft || !dateRight) return 999;

  return Math.abs(Math.round((dateLeft.getTime() - dateRight.getTime()) / 86400000));
}

function isMasrafText(text = "") {
  const normalized = normalizeParserText(text);
  return MASRAF_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function isPosKomisyonText(text = "") {
  const normalized = normalizeParserText(text);
  const hasPos = POS_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasFee = ["KOMISYON", "KOMİSYON", "BSMV", "MASRAF"].some((keyword) =>
    normalized.includes(keyword)
  );
  return hasPos && (hasFee || normalized.includes("POS"));
}

function resolveGuvenEtiketi(score) {
  if (score >= 90) return GUVEN_ETIKET.GUCLU;
  if (score >= 70) return GUVEN_ETIKET.OLASI;
  if (score >= 40) return GUVEN_ETIKET.KONTROL;
  return GUVEN_ETIKET.ESLESMEDI;
}

function resolveCounterAccountSimilarity(bank, muavin) {
  const suggestedCounter = suggestCounterAccount(bank);
  const muavinAccount = compactText(muavin.hesapKodu || "");

  if (suggestedCounter && muavinAccount) {
    const compactSuggested = compactText(suggestedCounter);
    if (
      muavinAccount.startsWith(compactSuggested.slice(0, 3)) ||
      muavinAccount.includes(compactSuggested)
    ) {
      return 6;
    }
  }

  const similarity = descriptionSimilarity(bank.aciklama, muavin.aciklama);
  if (similarity >= 0.65) return 3;
  return 0;
}

function scoreMatchPair(bank, muavin, context = {}) {
  const bankSigned = getSignedAmount(bank, "bank");
  const muavinSigned = getSignedAmount(muavin, "muavin");

  if (bankSigned.direction !== muavinSigned.direction) return null;

  const bankAmount = bankSigned.amount;
  const muavinAmount = muavinSigned.amount;
  const sameDate = normalizeMovementDate(bank.tarih) === normalizeMovementDate(muavin.tarih);
  const dayDiff = daysBetweenDates(bank.tarih, muavin.tarih);
  const amountDiff = Math.abs(bankAmount - muavinAmount);
  const sameAmount = amountDiff <= 0.01;
  const similarity = descriptionSimilarity(bank.aciklama, muavin.aciklama);
  const memoryBoost = getMutabakatMatchMemoryBoost(bank, muavin, context);
  const counterBoost = resolveCounterAccountSimilarity(bank, muavin);

  let score = 0;
  let method = "";

  if (sameDate && sameAmount && similarity >= 0.45) {
    score = 95 + Math.round(similarity * 5);
    method = "tarih+tutar+açıklama";
  } else if (sameAmount && dayDiff <= 3 && similarity >= 0.3) {
    score = 78 + Math.round(similarity * 10) - dayDiff * 2;
    method = "tutar+yakın tarih";
  } else if (sameAmount && dayDiff <= 7 && similarity >= 0.55) {
    score = 72 + Math.round(similarity * 8) - Math.max(0, dayDiff - 3);
    method = "açıklama benzerliği";
  } else if (sameAmount && similarity >= 0.72) {
    score = 70 + Math.round(similarity * 12);
    method = "tutar+açıklama benzerliği";
  } else if (!sameAmount && similarity >= 0.5 && dayDiff <= 7) {
    score = 42 + Math.round(similarity * 20) - Math.min(12, Math.round(amountDiff / 10));
    method = "benzer açıklama";
  }

  const bankRef = compactText(bank.dekontNo || bank.evrakNo);
  const muavinRef = compactText(muavin.evrakNo);
  if (bankRef && muavinRef && bankRef === muavinRef) {
    score = Math.max(score, sameAmount ? 93 : 76);
    method = method || "referans/dekont no";
  }

  score += counterBoost + memoryBoost;
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
    memoryBoost,
    counterBoost,
  };
}

function buildSpecialWarnings(bank, muavin, bankAmount, muavinAmount) {
  const warnings = [];
  const amountDiff = Math.abs(bankAmount - muavinAmount);
  const combinedText = `${bank?.aciklama || ""} ${muavin?.aciklama || ""}`;

  if (amountDiff <= 0.01) return warnings;

  if (isPosKomisyonText(combinedText)) {
    const baseAmount = Math.max(bankAmount, muavinAmount);
    const ratio = baseAmount > 0 ? amountDiff / baseAmount : 0;
    if (ratio <= 0.08 || amountDiff <= 500) {
      warnings.push("POS işleminde net/brüt veya komisyon farkı olabilir.");
    }
  }

  if (isMasrafText(combinedText) && amountDiff > 0.01 && amountDiff <= 100) {
    warnings.push("Banka masrafı veya BSMV kaynaklı küçük tutar farkı olabilir.");
  }

  return warnings;
}

function resolveMutabakatGrup(row = {}) {
  const durum = row.durum;
  const score = row.guvenSkoru || 0;

  if (
    durum === MUTABAKAT_DURUM.TAM_ESLESTI ||
    (row.isMatched && score >= 90)
  ) {
    return MUTABAKAT_GRUP.TAM_ESLESEN;
  }

  if (
    durum === MUTABAKAT_DURUM.OLASI_ESLESTI ||
    row.needsManualApproval ||
    (score >= 70 && score < 90 && row.muavinRow && row.bankRow)
  ) {
    return MUTABAKAT_GRUP.OLASI_ESLESEN;
  }

  if (
    [
      MUTABAKAT_DURUM.BANKADA_VAR,
      MUTABAKAT_DURUM.EKSIK_MASRAF,
      MUTABAKAT_DURUM.EKSIK_POS,
    ].includes(durum)
  ) {
    return MUTABAKAT_GRUP.BANKADA_VAR;
  }

  if (durum === MUTABAKAT_DURUM.MUAVINDE_VAR) {
    return MUTABAKAT_GRUP.MUAVINDE_VAR;
  }

  if (
    [
      MUTABAKAT_DURUM.TUTAR_FARKI,
      MUTABAKAT_DURUM.ACIKLAMA_BENZER_TUTAR_FARKLI,
      MUTABAKAT_DURUM.BSMV_MASRAF_FARKI,
      MUTABAKAT_DURUM.POS_KOMISYON_FARKI,
    ].includes(durum)
  ) {
    return MUTABAKAT_GRUP.TUTAR_FARKI;
  }

  if (durum === MUTABAKAT_DURUM.TARIH_FARKI) {
    return MUTABAKAT_GRUP.TARIH_FARKI;
  }

  if (durum === MUTABAKAT_DURUM.MUKERRER) {
    return MUTABAKAT_GRUP.MUKERRER;
  }

  if (score >= 40 && score < 70 && row.bankRow && row.muavinRow) {
    return MUTABAKAT_GRUP.OLASI_ESLESEN;
  }

  if (durum === MUTABAKAT_DURUM.ACIKLAMA_FARKI) {
    return score >= 70 ? MUTABAKAT_GRUP.OLASI_ESLESEN : MUTABAKAT_GRUP.TARIH_FARKI;
  }

  return MUTABAKAT_GRUP.TAM_ESLESEN;
}

function buildMovementKey(row, side) {
  const { amount } = getSignedAmount(row, side);
  return [compactText(normalizeMovementDate(row.tarih)), amount.toFixed(2), compactText(row.aciklama)].join("|");
}

function resolveBank102Account(bankId, company = {}) {
  const fallback = DEFAULT_102_BY_BANK[bankId] || "102";
  const bankAccounts = company.bankAccounts || [];
  const matchedBank = bankAccounts.find((bank) => {
    if (bank.isActive === false) return false;
    return compactText(bank.bankName).includes(compactText(bankId));
  });

  return resolve102BankAccount(
    bankAccounts,
    matchedBank?.lucaAccountCode || fallback,
    matchedBank?.lucaAccountCode || fallback
  );
}

function suggestCounterAccount(row) {
  const text = row.aciklama || "";
  if (isMasrafText(text)) return "780.01.001";
  if (isPosKomisyonText(text)) return "780.01.001";
  return "";
}

export function buildMissingMuavinLucaSuggestion(bankRow, context = {}) {
  if (!bankRow) return [];

  const bankAccount = resolveBank102Account(context.bankId, context.company);
  const { amount, direction } = getSignedAmount(bankRow, "bank");
  const counterAccount = suggestCounterAccount(bankRow) || "770";
  const tarih = normalizeMovementDate(bankRow.tarih);
  const aciklama = bankRow.aciklama || "Banka hareketi";
  const fisNo = 1;

  const bankLine = finalizeStandardLucaRow({
    firmaId: context.firmaId || "",
    kaynakTipi: KAYNAK_TIPI.BANKA,
    kaynakAdi: context.bankId || "BANKA",
    fisNo,
    fisTarihi: tarih,
    fisAciklama: aciklama,
    belgeTuru: isPosKomisyonText(aciklama) ? "KR" : "DK",
    hesapKodu: bankAccount,
    evrakNo: bankRow.dekontNo || bankRow.evrakNo || "",
    evrakTarihi: tarih,
    detayAciklama: aciklama,
    borc: direction === "IN" ? amount : "",
    alacak: direction === "OUT" ? amount : "",
    kontrolNotu: "Mutabakat önerisi",
  });

  const counterLine = finalizeStandardLucaRow({
    firmaId: context.firmaId || "",
    kaynakTipi: KAYNAK_TIPI.BANKA,
    kaynakAdi: context.bankId || "BANKA",
    fisNo,
    fisTarihi: tarih,
    fisAciklama: aciklama,
    belgeTuru: bankLine.belgeTuru,
    hesapKodu: counterAccount,
    evrakNo: bankRow.dekontNo || bankRow.evrakNo || "",
    evrakTarihi: tarih,
    detayAciklama: aciklama,
    borc: direction === "OUT" ? amount : "",
    alacak: direction === "IN" ? amount : "",
    kontrolNotu: counterAccount ? "Karşı hesap önerisi" : "Karşı hesap kontrol edilmeli",
  });

  return [bankLine, counterLine];
}

function removeAt(list, index) {
  return list.filter((_, itemIndex) => itemIndex !== index);
}

function matchMovementLists(bankRows = [], muavinRows = [], context = {}) {
  let unmatchedBank = bankRows.map((row, index) => ({ ...row, _index: index }));
  let unmatchedMuavin = muavinRows.map((row, index) => ({ ...row, _index: index }));
  const pairs = [];
  const candidates = [];

  const tryPair = (bankIndex, muavinIndex, method, score, options = {}) => {
    const bank = unmatchedBank[bankIndex];
    const muavin = unmatchedMuavin[muavinIndex];
    if (!bank || !muavin) return false;

    pairs.push({
      bank,
      muavin,
      method,
      score,
      needsManualApproval: options.needsManualApproval === true,
      matchMeta: options.matchMeta || null,
    });
    unmatchedBank = removeAt(unmatchedBank, bankIndex);
    unmatchedMuavin = removeAt(unmatchedMuavin, muavinIndex);
    return true;
  };

  const findBest = (minScore, options = {}) => {
    let best = null;

    unmatchedBank.forEach((bank, bankIndex) => {
      unmatchedMuavin.forEach((muavin, muavinIndex) => {
        const result = scoreMatchPair(bank, muavin, context);
        if (!result || result.score < minScore) return;

        if (!best || result.score > best.score) {
          best = {
            bankIndex,
            muavinIndex,
            ...result,
            needsManualApproval: options.needsManualApproval === true,
          };
        }
      });
    });

    if (!best) return false;
    return tryPair(
      best.bankIndex,
      best.muavinIndex,
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

  unmatchedBank.forEach((bank) => {
    let bestCandidate = null;

    unmatchedMuavin.forEach((muavin) => {
      const result = scoreMatchPair(bank, muavin, context);
      if (!result || result.score < 40 || result.score >= 70) return;

      if (!bestCandidate || result.score > bestCandidate.score) {
        bestCandidate = { bank, muavin, ...result };
      }
    });

    if (bestCandidate) {
      candidates.push(bestCandidate);
    }
  });

  return { pairs, unmatchedBank, unmatchedMuavin, candidates };
}

function resolveRiskSeviyesi(durum) {
  if (
    [
      MUTABAKAT_DURUM.BANKADA_VAR,
      MUTABAKAT_DURUM.MUAVINDE_VAR,
      MUTABAKAT_DURUM.TUTAR_FARKI,
      MUTABAKAT_DURUM.EKSIK_MASRAF,
      MUTABAKAT_DURUM.EKSIK_POS,
    ].includes(durum)
  ) {
    return "Yüksek";
  }

  if (
    [
      MUTABAKAT_DURUM.TARIH_FARKI,
      MUTABAKAT_DURUM.ACIKLAMA_FARKI,
      MUTABAKAT_DURUM.ACIKLAMA_BENZER_TUTAR_FARKLI,
      MUTABAKAT_DURUM.MUKERRER,
      MUTABAKAT_DURUM.OLASI_ESLESTI,
      MUTABAKAT_DURUM.BSMV_MASRAF_FARKI,
      MUTABAKAT_DURUM.POS_KOMISYON_FARKI,
    ].includes(durum)
  ) {
    return "Orta";
  }

  return "Düşük";
}

function buildResultRow(base) {
  const bankRow = base.bankRow || null;
  const muavinRow = base.muavinRow || null;
  const guvenSkoru = base.guvenSkoru ?? 0;
  const row = {
    id: base.id,
    durum: base.durum,
    grup: base.grup || "",
    bankaTarihi: base.bankaTarihi ?? bankRow?.tarih ?? "",
    muavinTarihi: base.muavinTarihi ?? muavinRow?.tarih ?? "",
    bankaAciklama: base.bankaAciklama ?? bankRow?.aciklama ?? "",
    muavinAciklama: base.muavinAciklama ?? muavinRow?.aciklama ?? "",
    bankaTutari: base.bankaTutari,
    muavinTutari: base.muavinTutari,
    fark: base.fark,
    guvenSkoru,
    guvenEtiketi: base.guvenEtiketi || resolveGuvenEtiketi(guvenSkoru),
    aciklamaBenzerligi: base.aciklamaBenzerligi ?? 0,
    riskSeviyesi: resolveRiskSeviyesi(base.durum),
    oneri: base.oneri,
    uyariListesi: base.uyariListesi || [],
    eslesmeYontemi: base.eslesmeYontemi || "",
    needsManualApproval: Boolean(base.needsManualApproval),
    manualApproved: Boolean(base.manualApproved),
    isError: base.isError !== false,
    isMatched: base.isMatched === true,
    bankRow,
    muavinRow,
    suggestedLucaRows: base.suggestedLucaRows || [],
  };

  row.grup = row.grup || resolveMutabakatGrup(row);
  return row;
}

function detectDuplicateRows(rows, side) {
  const seen = new Map();
  const duplicates = new Set();

  rows.forEach((row, index) => {
    const key = buildMovementKey(row, side);
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

export function runBankaMutabakat({
  bankRows = [],
  muavinRows = [],
  bankId = "DIGER",
  company = {},
  firmaId = "",
} = {}) {
  const matchContext = { firmaId, bankId, companyId: firmaId };
  const normalizedBank = bankRows.map((row, index) => ({
    ...row,
    id: row.id || `bank-${index + 1}`,
    tarih: normalizeMovementDate(row.tarih),
    aciklama: String(row.aciklama || "").trim(),
  }));

  const normalizedMuavin = muavinRows.map((row, index) => ({
    ...row,
    id: row.id || `muavin-${index + 1}`,
    tarih: normalizeMovementDate(row.tarih),
    aciklama: String(row.aciklama || "").trim(),
  }));

  const { pairs, unmatchedBank, unmatchedMuavin, candidates } = matchMovementLists(
    normalizedBank,
    normalizedMuavin,
    matchContext
  );

  const results = [];
  let resultIndex = 1;

  pairs.forEach(({ bank, muavin, method, score, needsManualApproval, matchMeta }) => {
    const bankAmount = getSignedAmount(bank, "bank").amount;
    const muavinAmount = getSignedAmount(muavin, "muavin").amount;
    const amountDiff = Math.abs(bankAmount - muavinAmount);
    const dayDiff = daysBetweenDates(bank.tarih, muavin.tarih);
    const similarity = matchMeta?.similarity ?? descriptionSimilarity(bank.aciklama, muavin.aciklama);
    const specialWarnings = buildSpecialWarnings(bank, muavin, bankAmount, muavinAmount);
    const guvenSkoru = Math.min(100, score);

    let durum = MUTABAKAT_DURUM.TAM_ESLESTI;
    let oneri = "İşlem banka ve muavin arasında tam eşleşti.";
    let isError = false;
    let isMatched = true;
    let pendingApproval = needsManualApproval;

    if (pendingApproval && guvenSkoru < 90) {
      durum = MUTABAKAT_DURUM.OLASI_ESLESTI;
      oneri = "Olası eşleşme — manuel onay önerilir.";
      isError = true;
      isMatched = false;
    } else if (amountDiff > 0.01) {
      if (specialWarnings.some((item) => item.includes("BSMV"))) {
        durum = MUTABAKAT_DURUM.BSMV_MASRAF_FARKI;
        oneri = "BSMV veya banka masrafı kaynaklı küçük tutar farkı olabilir.";
      } else if (specialWarnings.some((item) => item.includes("POS"))) {
        durum = MUTABAKAT_DURUM.POS_KOMISYON_FARKI;
        oneri = "POS net/brüt veya komisyon farkı olabilir.";
      } else {
        durum = MUTABAKAT_DURUM.TUTAR_FARKI;
        oneri = "Tutar farkını kontrol edin.";
      }
      isError = true;
      isMatched = false;
    } else if (dayDiff > 0) {
      durum = MUTABAKAT_DURUM.TARIH_FARKI;
      oneri = `${dayDiff} gün tarih farkı var.`;
      isError = true;
      isMatched = false;
    } else if (similarity < 0.7) {
      durum = MUTABAKAT_DURUM.ACIKLAMA_FARKI;
      oneri = "Tutar ve tarih uyumlu; açıklamalar farklı.";
      isError = guvenSkoru < 90;
      isMatched = guvenSkoru >= 90;
    }

    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum,
        bankaTarihi: bank.tarih,
        muavinTarihi: muavin.tarih,
        bankaAciklama: bank.aciklama,
        muavinAciklama: muavin.aciklama,
        bankaTutari: bankAmount,
        muavinTutari: muavinAmount,
        fark: Number((bankAmount - muavinAmount).toFixed(2)),
        guvenSkoru,
        aciklamaBenzerligi: Number(similarity.toFixed(2)),
        oneri,
        uyariListesi: specialWarnings,
        eslesmeYontemi: method,
        needsManualApproval: pendingApproval,
        isError,
        isMatched,
        bankRow: bank,
        muavinRow: muavin,
      })
    );
  });

  const candidateBankIds = new Set();
  const candidateMuavinIds = new Set();

  candidates.forEach(({ bank, muavin, score, method, similarity, dayDiff }) => {
    candidateBankIds.add(bank.id);
    candidateMuavinIds.add(muavin.id);
    const bankAmount = getSignedAmount(bank, "bank").amount;
    const muavinAmount = getSignedAmount(muavin, "muavin").amount;
    const specialWarnings = buildSpecialWarnings(bank, muavin, bankAmount, muavinAmount);

    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum: MUTABAKAT_DURUM.OLASI_ESLESTI,
        bankaTarihi: bank.tarih,
        muavinTarihi: muavin.tarih,
        bankaAciklama: bank.aciklama,
        muavinAciklama: muavin.aciklama,
        bankaTutari: bankAmount,
        muavinTutari: muavinAmount,
        fark: Number((bankAmount - muavinAmount).toFixed(2)),
        guvenSkoru: score,
        aciklamaBenzerligi: Number(similarity.toFixed(2)),
        oneri:
          dayDiff > 0
            ? `${dayDiff} gün fark ile kontrol edilmeli eşleşme adayı.`
            : "Kontrol edilmeli eşleşme adayı.",
        uyariListesi: specialWarnings,
        eslesmeYontemi: method,
        needsManualApproval: true,
        isError: true,
        isMatched: false,
        bankRow: bank,
        muavinRow: muavin,
      })
    );
  });

  const bankDuplicateIndexes = detectDuplicateRows(normalizedBank, "bank");
  const muavinDuplicateIndexes = detectDuplicateRows(normalizedMuavin, "muavin");
  const reservedBankIds = new Set(candidateBankIds);
  const reservedMuavinIds = new Set(candidateMuavinIds);
  const nearMatches = [];

  unmatchedBank.forEach((bank) => {
    if (reservedBankIds.has(bank.id)) return;

    unmatchedMuavin.forEach((muavin) => {
      if (reservedMuavinIds.has(muavin.id)) return;

      const scored = scoreMatchPair(bank, muavin, matchContext);
      if (!scored) return;

      const bankAmount = getSignedAmount(bank, "bank").amount;
      const muavinAmount = getSignedAmount(muavin, "muavin").amount;

      if (scored.similarity >= 0.5 && Math.abs(bankAmount - muavinAmount) > 0.01) {
        nearMatches.push({ bank, muavin, ...scored, bankAmount, muavinAmount });
      }
    });
  });

  nearMatches.forEach(({ bank, muavin, bankAmount, muavinAmount, score, similarity }) => {
    reservedBankIds.add(bank.id);
    reservedMuavinIds.add(muavin.id);

    const specialWarnings = buildSpecialWarnings(bank, muavin, bankAmount, muavinAmount);

    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum: specialWarnings.some((item) => item.includes("POS"))
          ? MUTABAKAT_DURUM.POS_KOMISYON_FARKI
          : specialWarnings.some((item) => item.includes("BSMV"))
            ? MUTABAKAT_DURUM.BSMV_MASRAF_FARKI
            : MUTABAKAT_DURUM.ACIKLAMA_BENZER_TUTAR_FARKLI,
        bankaTarihi: bank.tarih,
        muavinTarihi: muavin.tarih,
        bankaAciklama: bank.aciklama,
        muavinAciklama: muavin.aciklama,
        bankaTutari: bankAmount,
        muavinTutari: muavinAmount,
        fark: Number((bankAmount - muavinAmount).toFixed(2)),
        guvenSkoru: Math.max(40, score),
        aciklamaBenzerligi: Number(similarity.toFixed(2)),
        oneri: "Açıklama benzer; tutar farkını inceleyin.",
        uyariListesi: specialWarnings,
        isError: true,
        isMatched: false,
        bankRow: bank,
        muavinRow: muavin,
      })
    );
  });

  unmatchedBank.forEach((bank) => {
    if (reservedBankIds.has(bank.id)) return;

    let durum = MUTABAKAT_DURUM.BANKADA_VAR;
    let oneri = "Muhasebe fişi oluşturulması önerilir.";
    let isError = true;

    if (bankDuplicateIndexes.has(bank._index)) {
      durum = MUTABAKAT_DURUM.MUKERRER;
      oneri = "Banka ekstresinde mükerrer hareket olabilir.";
    } else if (isMasrafText(bank.aciklama)) {
      durum = MUTABAKAT_DURUM.EKSIK_MASRAF;
      oneri = "780.01.001 veya ilgili masraf hesabına fiş önerilir.";
    } else if (isPosKomisyonText(bank.aciklama)) {
      durum = MUTABAKAT_DURUM.EKSIK_POS;
      oneri = "POS komisyon/masraf fişi eksik olabilir.";
    }

    const bankAmount = getSignedAmount(bank, "bank").amount;

    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum,
        bankaTarihi: bank.tarih,
        muavinTarihi: "",
        bankaAciklama: bank.aciklama,
        muavinAciklama: "",
        bankaTutari: bankAmount,
        muavinTutari: 0,
        fark: bankAmount,
        oneri,
        isError,
        isMatched: false,
        bankRow: bank,
        suggestedLucaRows: buildMissingMuavinLucaSuggestion(bank, {
          bankId,
          company,
          firmaId,
        }),
      })
    );
  });

  unmatchedMuavin.forEach((muavin) => {
    if (reservedMuavinIds.has(muavin.id)) return;

    let durum = MUTABAKAT_DURUM.MUAVINDE_VAR;
    let oneri = "Banka ekstresinde karşılığı bulunamadı.";
    let isError = true;

    if (muavinDuplicateIndexes.has(muavin._index)) {
      durum = MUTABAKAT_DURUM.MUKERRER;
      oneri = "Muavin kaydında mükerrer hareket olabilir.";
    }

    const muavinAmount = getSignedAmount(muavin, "muavin").amount;

    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum,
        bankaTarihi: "",
        muavinTarihi: muavin.tarih,
        bankaAciklama: "",
        muavinAciklama: muavin.aciklama,
        bankaTutari: 0,
        muavinTutari: muavinAmount,
        fark: -muavinAmount,
        oneri,
        isError,
        isMatched: false,
        muavinRow: muavin,
      })
    );
  });

  const grouped = groupMutabakatRows(results);

  const summary = {
    bankCount: normalizedBank.length,
    muavinCount: normalizedMuavin.length,
    matchedCount: pairs.length,
    tamEslesenCount: grouped[MUTABAKAT_GRUP.TAM_ESLESEN]?.length || 0,
    olasiEslesenCount: grouped[MUTABAKAT_GRUP.OLASI_ESLESEN]?.length || 0,
    eksikKayitCount:
      (grouped[MUTABAKAT_GRUP.BANKADA_VAR]?.length || 0) +
      (grouped[MUTABAKAT_GRUP.MUAVINDE_VAR]?.length || 0),
    farkKayitCount:
      (grouped[MUTABAKAT_GRUP.TUTAR_FARKI]?.length || 0) +
      (grouped[MUTABAKAT_GRUP.TARIH_FARKI]?.length || 0),
    riskliKayitCount: grouped[MUTABAKAT_GRUP.MUKERRER]?.length || 0,
    errorCount: results.filter((row) => row.isError).length,
    bankadaVarCount: grouped[MUTABAKAT_GRUP.BANKADA_VAR]?.length || 0,
    muavinVarCount: grouped[MUTABAKAT_GRUP.MUAVINDE_VAR]?.length || 0,
    tutarFarkiCount: grouped[MUTABAKAT_GRUP.TUTAR_FARKI]?.length || 0,
    tarihFarkiCount: grouped[MUTABAKAT_GRUP.TARIH_FARKI]?.length || 0,
    aciklamaFarkiCount: results.filter((row) => row.durum === MUTABAKAT_DURUM.ACIKLAMA_FARKI)
      .length,
  };

  return {
    rows: results,
    grouped,
    summary,
    preview: {
      bankSample: normalizedBank.slice(0, 5),
      muavinSample: normalizedMuavin.slice(0, 5),
    },
  };
}

export function groupMutabakatRows(rows = []) {
  const grouped = Object.fromEntries(
    Object.values(MUTABAKAT_GRUP).map((label) => [label, []])
  );

  rows.forEach((row) => {
    const grup = row.grup || resolveMutabakatGrup(row);
    if (!grouped[grup]) grouped[grup] = [];
    grouped[grup].push({ ...row, grup });
  });

  return grouped;
}

export function approveMutabakatMatch(row, context = {}) {
  if (!row?.bankRow || !row?.muavinRow) return row;

  return buildResultRow({
    ...row,
    durum: MUTABAKAT_DURUM.TAM_ESLESTI,
    guvenSkoru: Math.max(row.guvenSkoru || 0, 95),
    oneri: "Manuel onaylandı — eşleşme hafızaya alındı.",
    needsManualApproval: false,
    manualApproved: true,
    isError: false,
    isMatched: true,
    grup: MUTABAKAT_GRUP.TAM_ESLESEN,
  });
}

export function filterMutabakatRows(
  rows = [],
  { errorsOnly = false, hideMatched = false, group = "", riskyOnly = false, unmatchedOnly = false } = {}
) {
  return rows.filter((row) => {
    if (group && row.grup !== group) return false;

    if (unmatchedOnly && row.isMatched) return false;

    if (riskyOnly) {
      const risky =
        row.riskSeviyesi === "Yüksek" ||
        row.grup === MUTABAKAT_GRUP.MUKERRER ||
        (row.guvenSkoru >= 70 && row.needsManualApproval);
      if (!risky) return false;
    }

    if (hideMatched && row.durum === MUTABAKAT_DURUM.TAM_ESLESTI) {
      return false;
    }

    if (errorsOnly && !row.isError) {
      return false;
    }

    return true;
  });
}

export function buildMutabakatExcelRows(analysis) {
  return (analysis?.rows || []).map((row) => ({
    Grup: row.grup,
    Durum: row.durum,
    "Güven Skoru": row.guvenSkoru,
    "Güven Etiketi": row.guvenEtiketi,
    "Açıklama Benzerliği": row.aciklamaBenzerligi,
    "Banka Tarihi": row.bankaTarihi,
    "Muavin Tarihi": row.muavinTarihi,
    "Banka Açıklama": row.bankaAciklama,
    "Muavin Açıklama": row.muavinAciklama,
    "Banka Tutarı": row.bankaTutari,
    "Muavin Tutarı": row.muavinTutari,
    Fark: row.fark,
    Risk: row.riskSeviyesi,
    Uyarılar: (row.uyariListesi || []).join(" | "),
    Öneri: row.oneri,
    "Eşleşme Yöntemi": row.eslesmeYontemi,
    "Manuel Onay": row.manualApproved ? "Evet" : row.needsManualApproval ? "Bekliyor" : "Hayır",
  }));
}

export function recalculateMutabakatSummary(rows = [], grouped = {}, baseSummary = {}) {
  return {
    ...baseSummary,
    tamEslesenCount: grouped[MUTABAKAT_GRUP.TAM_ESLESEN]?.length || 0,
    olasiEslesenCount: grouped[MUTABAKAT_GRUP.OLASI_ESLESEN]?.length || 0,
    eksikKayitCount:
      (grouped[MUTABAKAT_GRUP.BANKADA_VAR]?.length || 0) +
      (grouped[MUTABAKAT_GRUP.MUAVINDE_VAR]?.length || 0),
    farkKayitCount:
      (grouped[MUTABAKAT_GRUP.TUTAR_FARKI]?.length || 0) +
      (grouped[MUTABAKAT_GRUP.TARIH_FARKI]?.length || 0),
    riskliKayitCount: grouped[MUTABAKAT_GRUP.MUKERRER]?.length || 0,
    errorCount: rows.filter((row) => row.isError).length,
    bankadaVarCount: grouped[MUTABAKAT_GRUP.BANKADA_VAR]?.length || 0,
    muavinVarCount: grouped[MUTABAKAT_GRUP.MUAVINDE_VAR]?.length || 0,
    tutarFarkiCount: grouped[MUTABAKAT_GRUP.TUTAR_FARKI]?.length || 0,
    tarihFarkiCount: grouped[MUTABAKAT_GRUP.TARIH_FARKI]?.length || 0,
    aciklamaFarkiCount: rows.filter((row) => row.durum === MUTABAKAT_DURUM.ACIKLAMA_FARKI)
      .length,
  };
}

export function buildMutabakatSummarySheetRows(analysis, meta = {}) {
  const summary = analysis?.summary || {};
  return [
    {
      Firma: meta.firma || "-",
      Banka: meta.bankId || "-",
      "Banka Hareketi": summary.bankCount || 0,
      "Muavin Hareketi": summary.muavinCount || 0,
      "Tam Eşleşen": summary.tamEslesenCount || 0,
      "Olası Eşleşen": summary.olasiEslesenCount || 0,
      "Eksik Kayıt": summary.eksikKayitCount || 0,
      "Fark Olan": summary.farkKayitCount || 0,
      "Riskli Kayıt": summary.riskliKayitCount || 0,
    },
  ];
}

export function buildSuggestedLucaExcelRows(suggestedRows = []) {
  return suggestedRows.map((row) => ({
    "Fiş No": row.fisNo,
    "Fiş Tarihi": row.fisTarihi,
    "Fiş Açıklama": row.fisAciklama,
    "Hesap Kodu": row.hesapKodu,
    "Evrak No": row.evrakNo,
    "Detay Açıklama": row.detayAciklama,
    Borç: row.borc,
    Alacak: row.alacak,
    "Belge Türü": row.belgeTuru,
  }));
}

export function buildManualMatchResult(bankRow, muavinRow, context = {}) {
  const scored = scoreMatchPair(bankRow, muavinRow, context);
  const bankAmount = getSignedAmount(bankRow, "bank").amount;
  const muavinAmount = getSignedAmount(muavin, "muavin").amount;
  const similarity = scored?.similarity ?? descriptionSimilarity(bankRow.aciklama, muavin.aciklama);
  const score = Math.max(scored?.score || 92, 92);

  return buildResultRow({
    id: `manual-${bankRow.id}-${muavinRow.id}-${Date.now()}`,
    durum: MUTABAKAT_DURUM.ESLESTI,
    bankaTarihi: bankRow.tarih,
    muavinTarihi: muavin.tarih,
    bankaAciklama: bankRow.aciklama,
    muavinAciklama: muavin.aciklama,
    bankaTutari: bankAmount,
    muavinTutari: muavinAmount,
    fark: Number((bankAmount - muavinAmount).toFixed(2)),
    guvenSkoru: score,
    aciklamaBenzerligi: Number(similarity.toFixed(2)),
    oneri: "Manuel eşleştirme yapıldı.",
    eslesmeYontemi: scored?.method || "manuel",
    needsManualApproval: false,
    manualApproved: true,
    isError: Math.abs(bankAmount - muavinAmount) > 0.01,
    isMatched: true,
    bankRow,
    muavinRow,
  });
}

export function applyManualMatchToAnalysis(analysis, bankRow, muavinRow, context = {}) {
  const rows = analysis?.rows || [];
  const newRow = buildManualMatchResult(bankRow, muavinRow, context);
  const nextRows = rows.filter((row) => {
    const bankOnly = row.bankRow?.id === bankRow.id && !row.muavinRow;
    const muavinOnly = row.muavinRow?.id === muavinRow.id && !row.bankRow;
    const duplicatePair =
      row.bankRow?.id === bankRow.id && row.muavinRow?.id === muavinRow.id;
    return !bankOnly && !muavinOnly && !duplicatePair;
  });

  nextRows.push(newRow);
  const grouped = groupMutabakatRows(nextRows);

  return {
    ...analysis,
    rows: nextRows,
    grouped,
    summary: recalculateMutabakatSummary(nextRows, grouped, analysis.summary),
  };
}

export function removeManualMatchFromAnalysis(analysis, resultRow, context = {}) {
  const { bankId = "DIGER", company = {}, firmaId = "" } = context;
  if (!resultRow?.bankRow && !resultRow?.muavinRow) return analysis;

  const rows = (analysis?.rows || []).filter((row) => row.id !== resultRow.id);
  const replacements = [];

  if (resultRow.bankRow) {
    const bank = resultRow.bankRow;
    const bankAmount = getSignedAmount(bank, "bank").amount;
    replacements.push(
      buildResultRow({
        id: `unmatched-bank-${bank.id}-${Date.now()}`,
        durum: MUTABAKAT_DURUM.BANKADA_VAR,
        bankaTarihi: bank.tarih,
        bankaAciklama: bank.aciklama,
        bankaTutari: bankAmount,
        fark: bankAmount,
        oneri: "Manuel eşleşme kaldırıldı — bankada kalan hareket.",
        isError: true,
        isMatched: false,
        bankRow: bank,
        suggestedLucaRows: buildMissingMuavinLucaSuggestion(bank, {
          bankId,
          company,
          firmaId,
        }),
      })
    );
  }

  if (resultRow.muavinRow) {
    const muavin = resultRow.muavinRow;
    const muavinAmount = getSignedAmount(muavin, "muavin").amount;
    replacements.push(
      buildResultRow({
        id: `unmatched-muavin-${muavin.id}-${Date.now()}`,
        durum: MUTABAKAT_DURUM.MUAVINDE_VAR,
        muavinTarihi: muavin.tarih,
        muavinAciklama: muavin.aciklama,
        muavinTutari: muavinAmount,
        fark: -muavinAmount,
        oneri: "Manuel eşleşme kaldırıldı — muavinde kalan kayıt.",
        isError: true,
        isMatched: false,
        muavinRow: muavin,
      })
    );
  }

  const nextRows = [...rows, ...replacements];
  const grouped = groupMutabakatRows(nextRows);

  return {
    ...analysis,
    rows: nextRows,
    grouped,
    summary: recalculateMutabakatSummary(nextRows, grouped, analysis.summary),
  };
}
