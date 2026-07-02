import { parseGarantiEkstre } from "../../parsers/garantiParser";
import { parseVakifbankEkstre } from "../../parsers/vakifbankParser";
import { resolve102BankAccount } from "@/src/utils/companyCenter";
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { finalizeStandardLucaRow, KAYNAK_TIPI } from "@/src/utils/standardLucaRow";
import { normalizeParserText } from "@/src/utils/textNormalize";

export const BANK_OPTIONS = [
  { id: "TEB", label: "TEB" },
  { id: "VAKIFBANK", label: "Vakıfbank" },
  { id: "GARANTI", label: "Garanti" },
  { id: "ZIRAAT", label: "Ziraat" },
  { id: "KUVEYT", label: "Kuveyt Türk" },
  { id: "DIGER", label: "Diğer" },
];

export const MUTABAKAT_DURUM = {
  TAM_ESLESTI: "Tam eşleşti",
  ESLESTI: "Eşleşti",
  BANKADA_VAR: "Bankada var, muhasebede yok",
  MUAVINDE_VAR: "Muhasebede var, bankada yok",
  TUTAR_FARKI: "Tutar farkı",
  TARIH_FARKI: "Tarih farkı",
  ACIKLAMA_FARKI: "Açıklama farkı",
  ACIKLAMA_BENZER_TUTAR_FARKLI: "Açıklama benzer ama tutar farklı",
  MUKERRER: "Mükerrer kayıt",
  EKSIK_MASRAF: "Eksik banka masrafı",
  EKSIK_POS: "Eksik POS komisyonu",
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

function matchMovementLists(bankRows = [], muavinRows = []) {
  let unmatchedBank = bankRows.map((row, index) => ({ ...row, _index: index }));
  let unmatchedMuavin = muavinRows.map((row, index) => ({ ...row, _index: index }));
  const pairs = [];

  const tryPair = (bankIndex, muavinIndex, method, score) => {
    const bank = unmatchedBank[bankIndex];
    const muavin = unmatchedMuavin[muavinIndex];
    if (!bank || !muavin) return false;

    pairs.push({ bank, muavin, method, score });
    unmatchedBank = removeAt(unmatchedBank, bankIndex);
    unmatchedMuavin = removeAt(unmatchedMuavin, muavinIndex);
    return true;
  };

  const findBest = (predicate) => {
    let best = null;

    unmatchedBank.forEach((bank, bankIndex) => {
      unmatchedMuavin.forEach((muavin, muavinIndex) => {
        const result = predicate(bank, muavin);
        if (!result) return;

        if (!best || result.score > best.score) {
          best = { bankIndex, muavinIndex, ...result };
        }
      });
    });

    if (!best) return false;
    return tryPair(best.bankIndex, best.muavinIndex, best.method, best.score);
  };

  while (
    findBest((bank, muavin) => {
      const bankAmount = getSignedAmount(bank, "bank").amount;
      const muavinAmount = getSignedAmount(muavin, "muavin").amount;
      const similarity = descriptionSimilarity(bank.aciklama, muavin.aciklama);
      const sameDate = normalizeMovementDate(bank.tarih) === normalizeMovementDate(muavin.tarih);
      const sameAmount = Math.abs(bankAmount - muavinAmount) <= 0.01;
      const sameDirection =
        getSignedAmount(bank, "bank").direction === getSignedAmount(muavin, "muavin").direction;

      if (!sameDate || !sameAmount || !sameDirection || similarity < 0.45) return null;

      return {
        method: "tarih+tutar+açıklama",
        score: 100 + similarity * 10,
      };
    })
  );

  while (
    findBest((bank, muavin) => {
      const bankAmount = getSignedAmount(bank, "bank").amount;
      const muavinAmount = getSignedAmount(muavin, "muavin").amount;
      const dayDiff = daysBetweenDates(bank.tarih, muavin.tarih);
      const similarity = descriptionSimilarity(bank.aciklama, muavin.aciklama);

      if (Math.abs(bankAmount - muavinAmount) > 0.01) return null;
      if (dayDiff > 3) return null;
      if (similarity < 0.3) return null;
      if (
        getSignedAmount(bank, "bank").direction !==
        getSignedAmount(muavin, "muavin").direction
      ) {
        return null;
      }

      return {
        method: "tutar+yakın tarih",
        score: 80 + similarity * 10 - dayDiff,
      };
    })
  );

  while (
    findBest((bank, muavin) => {
      const bankAmount = getSignedAmount(bank, "bank").amount;
      const muavinAmount = getSignedAmount(muavin, "muavin").amount;
      const dayDiff = daysBetweenDates(bank.tarih, muavin.tarih);
      const similarity = descriptionSimilarity(bank.aciklama, muavin.aciklama);

      if (Math.abs(bankAmount - muavinAmount) > 0.01) return null;
      if (dayDiff > 7) return null;
      if (similarity < 0.55) return null;
      if (
        getSignedAmount(bank, "bank").direction !==
        getSignedAmount(muavin, "muavin").direction
      ) {
        return null;
      }

      return {
        method: "açıklama benzerliği",
        score: 70 + similarity * 10 - dayDiff,
      };
    })
  );

  while (
    findBest((bank, muavin) => {
      const bankRef = compactText(bank.dekontNo || bank.evrakNo);
      const muavinRef = compactText(muavin.evrakNo);
      const bankAmount = getSignedAmount(bank, "bank").amount;
      const muavinAmount = getSignedAmount(muavin, "muavin").amount;

      if (!bankRef || !muavinRef || bankRef !== muavinRef) return null;
      if (Math.abs(bankAmount - muavinAmount) > 0.01) return null;
      if (
        getSignedAmount(bank, "bank").direction !==
        getSignedAmount(muavin, "muavin").direction
      ) {
        return null;
      }

      return { method: "referans/dekont no", score: 65 };
    })
  );

  return { pairs, unmatchedBank, unmatchedMuavin };
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
    ].includes(durum)
  ) {
    return "Orta";
  }

  return "Düşük";
}

function buildResultRow(base) {
  const bankRow = base.bankRow || null;
  const muavinRow = base.muavinRow || null;

  return {
    id: base.id,
    durum: base.durum,
    bankaTarihi: base.bankaTarihi ?? bankRow?.tarih ?? "",
    muavinTarihi: base.muavinTarihi ?? muavinRow?.tarih ?? "",
    bankaAciklama: base.bankaAciklama ?? bankRow?.aciklama ?? "",
    muavinAciklama: base.muavinAciklama ?? muavinRow?.aciklama ?? "",
    bankaTutari: base.bankaTutari,
    muavinTutari: base.muavinTutari,
    fark: base.fark,
    riskSeviyesi: resolveRiskSeviyesi(base.durum),
    oneri: base.oneri,
    eslesmeYontemi: base.eslesmeYontemi || "",
    isError: base.isError !== false,
    isMatched: base.isMatched === true,
    bankRow,
    muavinRow,
    suggestedLucaRows: base.suggestedLucaRows || [],
  };
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

  const { pairs, unmatchedBank, unmatchedMuavin } = matchMovementLists(
    normalizedBank,
    normalizedMuavin
  );

  const results = [];
  let resultIndex = 1;

  pairs.forEach(({ bank, muavin, method }) => {
    const bankAmount = getSignedAmount(bank, "bank").amount;
    const muavinAmount = getSignedAmount(muavin, "muavin").amount;
    const amountDiff = Math.abs(bankAmount - muavinAmount);
    const dayDiff = daysBetweenDates(bank.tarih, muavin.tarih);
    const similarity = descriptionSimilarity(bank.aciklama, muavin.aciklama);

    let durum = MUTABAKAT_DURUM.TAM_ESLESTI;
    let oneri = "İşlem banka ve muavin arasında tam eşleşti.";
    let isError = false;
    let isMatched = true;

    if (amountDiff > 0.01) {
      durum = MUTABAKAT_DURUM.TUTAR_FARKI;
      oneri = "Tutar farkını kontrol edin.";
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
      isError = true;
      isMatched = false;
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
        oneri,
        eslesmeYontemi: method,
        isError,
        isMatched,
        bankRow: bank,
        muavinRow: muavin,
      })
    );
  });

  const bankDuplicateIndexes = detectDuplicateRows(normalizedBank, "bank");
  const muavinDuplicateIndexes = detectDuplicateRows(normalizedMuavin, "muavin");

  unmatchedBank.forEach((bank) => {
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

  const nearMatches = [];

  unmatchedBank.forEach((bank) => {
    unmatchedMuavin.forEach((muavin) => {
      const similarity = descriptionSimilarity(bank.aciklama, muavin.aciklama);
      const bankAmount = getSignedAmount(bank, "bank").amount;
      const muavinAmount = getSignedAmount(muavin, "muavin").amount;

      if (similarity >= 0.5 && Math.abs(bankAmount - muavinAmount) > 0.01) {
        nearMatches.push({ bank, muavin, similarity, bankAmount, muavinAmount });
      }
    });
  });

  nearMatches.forEach(({ bank, muavin, bankAmount, muavinAmount }) => {
    const alreadyCovered = results.some(
      (row) =>
        row.bankRow?.id === bank.id &&
        row.muavinRow?.id === muavin.id &&
        row.durum !== MUTABAKAT_DURUM.TAM_ESLESTI
    );

    if (alreadyCovered) return;

    results.push(
      buildResultRow({
        id: `result-${resultIndex++}`,
        durum: MUTABAKAT_DURUM.ACIKLAMA_BENZER_TUTAR_FARKLI,
        bankaTarihi: bank.tarih,
        muavinTarihi: muavin.tarih,
        bankaAciklama: bank.aciklama,
        muavinAciklama: muavin.aciklama,
        bankaTutari: bankAmount,
        muavinTutari: muavinAmount,
        fark: Number((bankAmount - muavinAmount).toFixed(2)),
        oneri: "Açıklama benzer; tutar farkını inceleyin.",
        isError: true,
        isMatched: false,
        bankRow: bank,
        muavinRow: muavin,
      })
    );
  });

  const summary = {
    bankCount: normalizedBank.length,
    muavinCount: normalizedMuavin.length,
    matchedCount: pairs.length,
    tamEslesenCount: results.filter((row) => row.durum === MUTABAKAT_DURUM.TAM_ESLESTI)
      .length,
    errorCount: results.filter((row) => row.isError).length,
    bankadaVarCount: results.filter((row) => row.durum === MUTABAKAT_DURUM.BANKADA_VAR)
      .length,
    muavinVarCount: results.filter((row) => row.durum === MUTABAKAT_DURUM.MUAVINDE_VAR)
      .length,
    tutarFarkiCount: results.filter((row) => row.durum === MUTABAKAT_DURUM.TUTAR_FARKI)
      .length,
    tarihFarkiCount: results.filter((row) => row.durum === MUTABAKAT_DURUM.TARIH_FARKI)
      .length,
    aciklamaFarkiCount: results.filter((row) => row.durum === MUTABAKAT_DURUM.ACIKLAMA_FARKI)
      .length,
  };

  return {
    rows: results,
    summary,
    preview: {
      bankSample: normalizedBank.slice(0, 5),
      muavinSample: normalizedMuavin.slice(0, 5),
    },
  };
}

export function filterMutabakatRows(
  rows = [],
  { errorsOnly = false, hideMatched = false } = {}
) {
  return rows.filter((row) => {
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
    Durum: row.durum,
    "Banka Tarihi": row.bankaTarihi,
    "Muavin Tarihi": row.muavinTarihi,
    "Banka Açıklama": row.bankaAciklama,
    "Muavin Açıklama": row.muavinAciklama,
    "Banka Tutarı": row.bankaTutari,
    "Muavin Tutarı": row.muavinTutari,
    Fark: row.fark,
    Risk: row.riskSeviyesi,
    Öneri: row.oneri,
    "Eşleşme Yöntemi": row.eslesmeYontemi,
  }));
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
