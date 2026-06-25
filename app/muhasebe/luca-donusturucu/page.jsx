"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  countCompanyRules,
  countPendingLucaRowsForCompany,
  formatDateTime,
  getAccountPlanForCompany,
  getAccountPlanUploadedAt,
  getCompanyRulesUpdatedAt,
  loadAccountPlansFromStorage,
  loadPendingLucaRows,
  loadRuleEngineFromStorage,
  normalizeCompanyRecord,
  resolve102BankAccount,
} from "@/src/utils/companyCenter";
import {
  findCreditCardByText,
  buildCreditCardPaymentDescription,
  getCreditCardAccount,
} from "@/src/utils/creditCardAccountResolver";
import { findCariAccountInPlan } from "@/src/utils/bankMovementMapper";

const LUCA_EXPORT_HEADERS = [
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

export default function LucaDonusturucuPage() {
  const [hareketFileName, setHareketFileName] = useState("");
  const [rawRows, setRawRows] = useState([]);
  const [fisler, setFisler] = useState([]);
  const [accountPlans, setAccountPlans] = useState({});
  const [ruleEngine, setRuleEngine] = useState({});

  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany: selectedCompanyRaw,
    refreshCompanies,
  } = useCompanyList();

  const selectedCompany = useMemo(
    () => normalizeCompanyRecord(selectedCompanyRaw),
    [selectedCompanyRaw]
  );

  useEffect(() => {
    const refreshCompanyData = () => {
      setAccountPlans(loadAccountPlansFromStorage());
      setRuleEngine(loadRuleEngineFromStorage());
      refreshCompanies();
    };

    refreshCompanyData();

    window.addEventListener("focus", refreshCompanyData);

    return () => {
      window.removeEventListener("focus", refreshCompanyData);
    };
  }, [refreshCompanies]);

  useEffect(() => {
    const pending = loadPendingLucaRows();
    if (!pending?.rows?.length) return;

    if (pending.companyId) {
      setSelectedCompanyId(pending.companyId);
    }

    setRawRows(pending.rows);
    setFisler([]);
    setHareketFileName(
      pending.companyName
        ? `${pending.companyName} — ${pending.rows.length} satır (Banka Parser)`
        : `Banka Parser (${pending.rows.length} satır)`
    );
  }, [setSelectedCompanyId]);

  const companyPlans = useMemo(
    () => getAccountPlanForCompany(accountPlans, selectedCompanyId),
    [accountPlans, selectedCompanyId]
  );

  const ruleCount = useMemo(
    () => countCompanyRules(ruleEngine, selectedCompanyId),
    [ruleEngine, selectedCompanyId]
  );

  const hasRules = ruleCount > 0;

  const activeBankCount = useMemo(
    () =>
      (selectedCompany?.bankAccounts || []).filter(
        (bank) => bank.isActive !== false
      ).length,
    [selectedCompany]
  );

  const activeCreditCardCount = useMemo(
    () =>
      (selectedCompany?.creditCards || []).filter(
        (card) => card.isActive !== false
      ).length,
    [selectedCompany]
  );

  const documentSeriesCount = selectedCompany?.documentSeriesRules?.length || 0;

  const lastPlanUploadedAt = useMemo(
    () => formatDateTime(getAccountPlanUploadedAt(accountPlans, selectedCompanyId)),
    [accountPlans, selectedCompanyId]
  );

  const lastRuleUpdatedAt = useMemo(
    () => formatDateTime(getCompanyRulesUpdatedAt(ruleEngine, selectedCompanyId)),
    [ruleEngine, selectedCompanyId]
  );

  const pendingRowCount = useMemo(
    () => countPendingLucaRowsForCompany(selectedCompanyId),
    [selectedCompanyId, accountPlans, rawRows]
  );

  const normalizeText = (value) =>
    String(value || "")
      .toUpperCase()
      .replaceAll("İ", "I")
      .replaceAll("Ğ", "G")
      .replaceAll("Ü", "U")
      .replaceAll("Ş", "S")
      .replaceAll("Ö", "O")
      .replaceAll("Ç", "C")
      .replace(/[.,/()\-_*:;]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const compactText = (value) => normalizeText(value).replace(/\s+/g, "");

  const isCreditCardIslem = (type) =>
    type.includes("KREDI KARTI") || type.includes("KREDİ KARTI");

  const parseNumber = (value) => {
    if (typeof value === "number") return value;

    const cleaned = String(value || "")
      .replaceAll("TL", "")
      .replaceAll(".", "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");

    const number = Number(cleaned);
    return Number.isNaN(number) ? 0 : number;
  };

  const getValue = (row, key) => {
    const foundKey = Object.keys(row || {}).find(
      (k) => compactText(k) === compactText(key)
    );

    return foundKey ? row[foundKey] : "";
  };

  const simplifyWords = (text) =>
    normalizeText(text)
      .replace(/\bANONIM\b/g, " ")
      .replace(/\bSIRKETI\b/g, " ")
      .replace(/\bLIMITED\b/g, " ")
      .replace(/\bLTD\b/g, " ")
      .replace(/\bSTI\b/g, " ")
      .replace(/\bSANAYI\b/g, " ")
      .replace(/\bTICARET\b/g, " ")
      .replace(/\bTURIZM\b/g, " ")
      .replace(/\bOTELCILIK\b/g, " ")
      .replace(/\bVE\b/g, " ")
      .replace(/\bAS\b/g, " ")
      .replace(/\bYONETIM\b/g, "YON")
      .replace(/\bDANISMANLIGI\b/g, "DAN")
      .replace(/\bDANISMANLIK\b/g, "DAN")
      .split(/\s+/)
      .filter((word) => word.length > 2);

  const isSimilarWord = (a, b) => {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 3 && b.startsWith(a)) return true;
    if (b.length >= 3 && a.startsWith(b)) return true;
    return false;
  };

  const getAccountCode = (account) =>
    account?.accountCode || account?.hesapKodu || "";

  const findBestAccountFromDescription = (description) => {
    const descWords = simplifyWords(description);

    if (descWords.length === 0) return null;

    let bestMatch = null;
    let bestScore = 0;

    companyPlans.forEach((account) => {
      if (account.isActive === false) return;

      const accountWords = simplifyWords(
        account.accountName || account.hesapAdi || ""
      );

      if (accountWords.length === 0) return;

      let score = 0;

      accountWords.forEach((accountWord) => {
        const matched = descWords.some((descWord) =>
          isSimilarWord(descWord, accountWord)
        );

        if (matched) score += 1;
      });

      if (score > bestScore) {
        bestScore = score;
        bestMatch = account;
      }
    });

    return bestScore >= 2 ? bestMatch : null;
  };

  const isGenericCariFallback = (code) => {
    const compact = compactText(code);

    if (!compact) return true;

    return [
      compactText("HESAP PLANINDAN"),
      "320",
      compactText("320.01.001"),
      "120",
      compactText("120.01.001"),
    ].includes(compact);
  };

  const isCariCode = (code) => {
    const compact = compactText(code);
    return compact.startsWith("320") || compact.startsWith("120");
  };

  const accountExistsInPlan = (code) => {
    if (!code) return false;

    const wanted = compactText(code);

    return companyPlans.some(
      (account) => compactText(getAccountCode(account)) === wanted
    );
  };

  // Cari hesap çözümü gerekiyor mu? Genel fallback (boş/320/120) veya
  // hesap planında bulunmayan 320/120 kodları için gerçek hesap aranır.
  const needsCariResolve = (code) =>
    isGenericCariFallback(code) ||
    (isCariCode(code) && !accountExistsInPlan(code));

  const buildDescription = ({
    islemTipi,
    rawDescription,
    matchedAccount,
    paymentDate,
  }) => {
    const type = normalizeText(islemTipi);

    if (type.includes("POS TAHSILATI")) return "POS TAHSİLATI";
    if (type.includes("POS KOMISYONU")) return "POS KOMİSYONU";
    if (type.includes("TRAFIK")) return "TRAFİK CEZASI ÖDEMESİ";
    if (type.includes("SGK")) return "SGK ÖDEMESİ";

    if (type.includes("VERGI")) return "VERGİ ÖDEMESİ";
    if (type.includes("CEK") || type.includes("CEK ODEME")) return "ÇEK ÖDEMESİ";
    if (type.includes("MAAS")) return "MAAŞ ÖDEMESİ";
    if (type.includes("AVANS")) return "AVANS ÖDEMESİ";
    if (type.includes("DOVIZ ALIS")) return "DÖVİZ ALIŞ";
    if (type.includes("DOVIZ SATIS")) return "DÖVİZ SATIŞ";

    const name =
      matchedAccount?.hesapAdi ||
      matchedAccount?.accountName ||
      String(rawDescription || "").replace(/\s+/g, " ").trim().slice(0, 80);

    if (type.includes("GELEN")) return `GLN. HVL / ${name}`;
    if (type.includes("GIDEN")) return `GÖND. HVL / ${name}`;

    return name;
  };

  const resolve102 = (accountCode, lucaBankaHesabi) =>
    resolve102BankAccount(
      selectedCompany?.bankAccounts || [],
      accountCode,
      lucaBankaHesabi
    );

  const formatLucaDate = (value) => {
    if (!value) return "";

    if (value instanceof Date) {
      const day = String(value.getDate()).padStart(2, "0");
      const month = String(value.getMonth() + 1).padStart(2, "0");
      return `${day}.${month}.${value.getFullYear()}`;
    }

    const text = String(value).trim();

    if (/^\d{2}\.\d{2}\.\d{4}$/.test(text)) return text;

    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      const [year, month, day] = text.slice(0, 10).split("-");
      return `${day}.${month}.${year}`;
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
      return text.replaceAll("/", ".");
    }

    const parsed = new Date(text);

    if (!Number.isNaN(parsed.getTime())) {
      const day = String(parsed.getDate()).padStart(2, "0");
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      return `${day}.${month}.${parsed.getFullYear()}`;
    }

    return text;
  };

  const toNumericAmount = (value) => {
    if (value === "" || value === null || value === undefined) return "";

    const number = Number(value);
    return Number.isNaN(number) ? "" : number;
  };

  const resolveBelgeTuru = ({
    explicit,
    islemTipi,
    rawDescription,
    isCreditCard,
  }) => {
    const fromExplicit = String(explicit || "").trim().toUpperCase();
    if (fromExplicit) return fromExplicit;

    if (isCreditCard) return "KR";

    const text = normalizeText(`${islemTipi} ${rawDescription}`);

    if (
      text.includes("KREDI KARTI") ||
      text.includes("EKSTRE") ||
      text.includes("KREDI KART")
    ) {
      return "KR";
    }

    if (text.includes("NOTER")) return "NM";
    if (text.includes("SMM")) return "SMM";
    if (text.includes("FATURA")) return "EF";

    if (
      text.includes("HAVALE") ||
      text.includes("EFT") ||
      text.includes("GOND HVL") ||
      text.includes("GLN HVL") ||
      text.includes("VIRMAN") ||
      text.includes("MASRAF")
    ) {
      return "DK";
    }

    return "DK";
  };

  const handleHareketFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRawRows([]);
    setFisler([]);
    setHareketFileName(file.name);

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { cellDates: true });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

    const jsonRows = XLSX.utils.sheet_to_json(worksheet, {
      defval: "",
    });

    setRawRows(jsonRows);
  };

  const createFisler = () => {
    try {
      if (!selectedCompany) {
        alert("Önce firma seçmelisin.");
        return;
      }

      if (!rawRows || rawRows.length === 0) {
        alert("Önce standart hareket dosyası yüklemelisin.");
        return;
      }

      const createdFisler = [];

      rawRows.forEach((row, index) => {
        try {
          const islemTipi = String(getValue(row, "IslemTipi") || "");
          const rawDescription = String(getValue(row, "Aciklama") || "");
          const tarih = getValue(row, "Tarih");
          const tutar = parseNumber(getValue(row, "Tutar"));
          const lucaBankaHesabi = String(
            getValue(row, "LucaBankaHesabi") || ""
          );
          const pendingLucaAciklama = String(getValue(row, "LucaAciklama") || "");

          if (!tutar) return;

          const type = normalizeText(islemTipi);
          const descText = normalizeText(rawDescription);
          const matchedAccount = findBestAccountFromDescription(rawDescription);
          const matchedCreditCard = findCreditCardByText(
            selectedCompany.creditCards || [],
            rawDescription
          );

          let borcluHesap = String(getValue(row, "BorcluHesap") || "");
          let alacakliHesap = String(getValue(row, "AlacakliHesap") || "");
          let customAciklama = null;

          let satirUyari = "";
          const isCreditCard =
            isCreditCardIslem(type) ||
            !!matchedCreditCard ||
            descText.includes("KREDI KARTI") ||
            descText.includes("KREDI KART") ||
            descText.includes("EKSTRE");

          if (isCreditCard) {
            const resolvedCard = getCreditCardAccount({
              creditCard: matchedCreditCard,
              paymentDate: tarih || new Date(),
              installmentYearShift: false,
            });

            if (!matchedCreditCard) {
              borcluHesap = "";
              satirUyari = "Kredi kartı eşleşmedi";
            } else if (resolvedCard.accountCode) {
              borcluHesap = resolvedCard.accountCode;
            } else {
              borcluHesap = "";
              satirUyari = resolvedCard.warning || "Kredi kartı hesabı çözülemedi";
            }

            customAciklama = buildCreditCardPaymentDescription({
              creditCard: matchedCreditCard,
              paymentDate: tarih || new Date(),
              rawDescription,
            });
          }

          borcluHesap = resolve102(borcluHesap, lucaBankaHesabi);
          alacakliHesap = resolve102(alacakliHesap, lucaBankaHesabi);

          if (!isCreditCard && type.includes("GELEN")) {
            borcluHesap = borcluHesap || lucaBankaHesabi;

            if (needsCariResolve(alacakliHesap)) {
              const cariKod =
                getAccountCode(matchedAccount) ||
                findCariAccountInPlan(companyPlans, rawDescription);

              if (cariKod) {
                alacakliHesap = cariKod;
              } else {
                alacakliHesap = "";
                satirUyari = satirUyari || "Cari hesap bulunamadı";
              }
            }
          }

          if (!isCreditCard && type.includes("GIDEN")) {
            alacakliHesap = alacakliHesap || lucaBankaHesabi;

            if (needsCariResolve(borcluHesap)) {
              const cariKod =
                getAccountCode(matchedAccount) ||
                findCariAccountInPlan(companyPlans, rawDescription);

              if (cariKod) {
                borcluHesap = cariKod;
              } else {
                borcluHesap = "";
                satirUyari = satirUyari || "Cari hesap bulunamadı";
              }
            }
          }

          if (type.includes("POS TAHSILATI")) {
            borcluHesap = borcluHesap || lucaBankaHesabi;
            alacakliHesap =
              alacakliHesap ||
              selectedCompany.accountingRules?.posAccountCode ||
              "108";
          }

          if (type.includes("POS KOMISYONU")) {
            borcluHesap = borcluHesap || "780.01.001";
            alacakliHesap = alacakliHesap || lucaBankaHesabi;
          }

          const fisAciklama =
            pendingLucaAciklama ||
            customAciklama ||
            buildDescription({
              islemTipi,
              rawDescription,
              matchedAccount,
              paymentDate: tarih,
            });

          const belgeTuru = resolveBelgeTuru({
            explicit:
              getValue(row, "BelgeTuru") || getValue(row, "DocumentType"),
            islemTipi,
            rawDescription,
            isCreditCard,
          });

          createdFisler.push({
            fisNo: createdFisler.length + 1,
            tarih,
            aciklama: fisAciklama,
            belgeTuru,
            uyari: satirUyari,
            satirlar: [
              {
                hesapKodu: borcluHesap,
                aciklama: fisAciklama,
                borc: tutar,
                alacak: "",
                uyari: satirUyari,
              },
              {
                hesapKodu: alacakliHesap,
                aciklama: fisAciklama,
                borc: "",
                alacak: tutar,
              },
            ],
          });
        } catch (rowError) {
          console.error("Satır işlenemedi:", index + 1, rowError, row);
        }
      });

      setFisler(createdFisler);
      alert(`${createdFisler.length} fiş oluşturuldu.`);
    } catch (error) {
      console.error("Ön izleme genel hata:", error);
      alert("Ön izleme oluşturulurken hata oluştu: " + error.message);
    }
  };

  const exportExcel = () => {
    if (!fisler || fisler.length === 0) {
      alert("Önce ön izleme oluştur.");
      return;
    }

    const chunkSize = 50;
    const totalFiles = Math.ceil(fisler.length / chunkSize);

    for (let fileIndex = 0; fileIndex < totalFiles; fileIndex++) {
      const chunk = fisler.slice(
        fileIndex * chunkSize,
        fileIndex * chunkSize + chunkSize
      );

      const excelRows = [];

      chunk.forEach((fis, index) => {
        const yeniFisNo = index + 1;
        const fisTarihi = formatLucaDate(fis.tarih);

        fis.satirlar.forEach((satir) => {
          excelRows.push({
            "Fiş No": yeniFisNo,
            "Fiş Tarihi": fisTarihi,
            "Fiş Açıklama": fis.aciklama || "",
            "Hesap Kodu": satir.hesapKodu || "",
            "Evrak No": "",
            "Evrak Tarihi": fisTarihi,
            "Detay Açıklama": satir.aciklama || "",
            "Borç": toNumericAmount(satir.borc),
            "Alacak": toNumericAmount(satir.alacak),
            "Miktar": "",
            "Belge Türü": fis.belgeTuru || "DK",
            "Para Birimi": "TL",
            "Kur": "",
            "Döviz Tutar": "",
          });
        });
      });

      const worksheet = XLSX.utils.json_to_sheet(excelRows, {
        header: LUCA_EXPORT_HEADERS,
      });
      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(workbook, worksheet, "Fiş Aktarım Şablon");

      const firmaKisa = getCompanyDisplayName(selectedCompany)
        .split(" ")[0]
        .toLowerCase()
        .replaceAll("ı", "i")
        .replaceAll("ğ", "g")
        .replaceAll("ü", "u")
        .replaceAll("ş", "s")
        .replaceAll("ö", "o")
        .replaceAll("ç", "c");

      const ilkTarih = String(chunk[0]?.tarih || "")
        .replaceAll(".", "")
        .replaceAll("/", "")
        .replaceAll("-", "");

      const ilkFis = fileIndex * chunkSize + 1;
      const sonFis = Math.min((fileIndex + 1) * chunkSize, fisler.length);

      XLSX.writeFile(
        workbook,
        `${firmaKisa}_${ilkTarih}_fis${ilkFis}-${sonFis}.xlsx`
      );
    }

    alert(`${totalFiles} adet Luca Excel dosyası oluşturuldu.`);
  };

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      <MuhasebeMenu />

      <h1 className="mb-10 text-4xl font-bold">Luca Fiş Üretici</h1>

      <div className="grid max-w-6xl gap-6">
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-2xl font-semibold">Firma Seçimi</h2>

          <select
            value={selectedCompanyId}
            onChange={(e) => {
              setSelectedCompanyId(e.target.value);
              setFisler([]);
            }}
            className="mb-4 min-w-[320px] rounded-xl border border-gray-700 bg-gray-950 p-3 text-white"
          >
            <CompanySelectOptions companies={companies} />
          </select>

          {selectedCompany && (
            <div className="mt-2 rounded-2xl border border-gray-800 bg-gray-950/60 p-5">
              <div className="mb-4 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                <h3 className="text-base font-semibold text-gray-100">
                  Seçili Firma Kontrol Özeti
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <ControlStat
                  label="Firma"
                  value={getCompanyDisplayName(selectedCompany)}
                  clamp
                  wide
                />
                <ControlStat
                  label="Banka Hesabı"
                  value={activeBankCount}
                  status={activeBankCount > 0 ? "ready" : "missing"}
                />
                <ControlStat
                  label="Kredi Kartı"
                  value={activeCreditCardCount}
                  status={activeCreditCardCount > 0 ? "ready" : "missing"}
                />
                <ControlStat
                  label="Hesap Planı"
                  value={companyPlans.length > 0 ? "Hazır" : "Eksik"}
                  status={companyPlans.length > 0 ? "ready" : "missing"}
                />
                <ControlStat
                  label="Kural Durumu"
                  value={hasRules ? "Hazır" : "Eksik"}
                  status={hasRules ? "ready" : "missing"}
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <ControlStat
                  label="Son Hesap Planı Yükleme"
                  value={lastPlanUploadedAt || "Kayıt yok"}
                  secondary
                />
                <ControlStat
                  label="Son Kural Güncelleme"
                  value={lastRuleUpdatedAt || "Kayıt yok"}
                  secondary
                />
                <ControlStat
                  label="Bekleyen Luca Satırı"
                  value={pendingRowCount}
                  badge={pendingRowCount > 0 ? "warning" : "ok"}
                />
              </div>

              <p className="mt-4 text-xs text-gray-500">
                Fiş üretimi öncesi firma yapılandırma kontrolü
              </p>

              {documentSeriesCount > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  Belge serisi kuralı: {documentSeriesCount} kayıt bağlı.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-2xl font-semibold">
            Standart Hareket Dosyası
          </h2>

          <p className="mb-6 text-gray-400">
            Banka parser merkezinden çıkan standart hareket dosyasını yükleyin.
          </p>

          <div className="flex items-center gap-4">
            <label className="cursor-pointer rounded-lg bg-blue-600 px-5 py-2 font-medium hover:bg-blue-700">
              Dosya Seç
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleHareketFile}
                className="hidden"
              />
            </label>

            <span className="text-gray-400">
              {hareketFileName || "Henüz dosya seçilmedi"}
            </span>
          </div>

          {rawRows.length > 0 && (
            <p className="mt-4 text-sm text-green-400">
              {rawRows.length} satır okundu.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          <button
            onClick={createFisler}
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-700"
          >
            Ön İzleme Oluştur
          </button>

          <button
            onClick={exportExcel}
            className="rounded-xl bg-green-600 px-6 py-3 font-semibold hover:bg-green-700"
          >
            Luca Excel Oluştur
          </button>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-6 text-3xl font-bold">Ön İzleme</h2>

          {fisler.length === 0 ? (
            <p className="text-gray-400">Henüz fiş oluşturulmadı.</p>
          ) : (
            <div className="space-y-8">
              {fisler.slice(0, 50).map((fis) => (
                <div
                  key={`fis-${fis.fisNo}`}
                  className="rounded-xl border border-gray-700 p-4"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="text-xl font-semibold">
                        Fiş No: {fis.fisNo}
                      </h3>

                      <span className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-semibold text-gray-200">
                        Belge Türü: {fis.belgeTuru || "DK"}
                      </span>
                    </div>

                    {fis.uyari ? (
                      <span className="rounded-lg border border-yellow-700/60 bg-yellow-900/40 px-3 py-1 text-xs font-semibold text-yellow-300">
                        {fis.uyari}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">Belge No: boş</span>
                    )}
                  </div>

                  <table className="w-full text-sm">
                    <thead className="bg-gray-800 text-gray-300">
                      <tr>
                        <th className="p-3 text-left">Hesap Kodu</th>
                        <th className="p-3 text-left">Açıklama</th>
                        <th className="p-3 text-right">Borç</th>
                        <th className="p-3 text-right">Alacak</th>
                      </tr>
                    </thead>

                    <tbody>
                      {fis.satirlar.map((satir, index) => {
                        const hesapEksik =
                          !satir.hesapKodu ||
                          normalizeText(satir.hesapKodu).includes(
                            "BULUNAMADI"
                          ) ||
                          normalizeText(satir.hesapKodu).includes(
                            "HESAP PLANINDAN"
                          ) ||
                          normalizeText(satir.hesapKodu).includes(
                            "ESLESTIRME"
                          );

                        return (
                          <tr
                            key={`fis-${fis.fisNo}-satir-${index}`}
                            className={`border-b border-gray-800 ${
                              hesapEksik ? "bg-red-900/50 text-red-100" : ""
                            }`}
                          >
                            <td className="p-3">{satir.hesapKodu}</td>
                            <td className="p-3">{satir.aciklama}</td>
                            <td className="p-3 text-right">{satir.borc}</td>
                            <td className="p-3 text-right">{satir.alacak}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}

              <p className="text-sm text-gray-400">
                Toplam {fisler.length} fiş oluşturuldu. İlk 50 fiş gösteriliyor.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function InfoStat({ label, value, truncate = false }) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-800 bg-gray-950 p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div
        className={`mt-2 text-lg font-bold leading-snug text-gray-100 ${
          truncate ? "truncate" : ""
        }`}
        title={truncate ? String(value) : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function ControlStat({
  label,
  value,
  status,
  badge,
  secondary = false,
  truncate = false,
  clamp = false,
  wide = false,
}) {
  const statusStyles = {
    ready: "border-emerald-800/60 bg-emerald-950/40",
    missing: "border-red-800/60 bg-red-950/40",
  };

  const valueStyles = {
    ready: "text-emerald-300",
    missing: "text-red-300",
  };

  const cardClass = status
    ? statusStyles[status]
    : "border-gray-800 bg-gray-900/60";

  const wideClass = wide ? "sm:col-span-2 lg:col-span-2" : "";

  let valueClass = "text-white";

  if (status) valueClass = valueStyles[status];
  if (secondary) valueClass = "text-slate-100";

  const labelClass =
    "text-xs font-semibold uppercase tracking-normal text-slate-200";

  if (badge) {
    const badgeStyles = {
      ok: "bg-emerald-900/50 text-emerald-300 border border-emerald-800/60",
      warning: "bg-yellow-900/40 text-yellow-300 border border-yellow-700/60",
    };

    return (
      <div
        className={`flex h-full min-w-0 flex-col rounded-xl border p-5 ${cardClass} ${wideClass}`}
      >
        <div className={labelClass}>{label}</div>
        <div className="mt-3 flex flex-1 items-end">
          <span
            className={`inline-flex items-center rounded-lg px-4 py-1.5 text-xl font-bold ${badgeStyles[badge]}`}
          >
            {value}
          </span>
        </div>
      </div>
    );
  }


  const valueSizeClass = secondary
    ? "text-lg tracking-tight"
    : clamp
    ? "text-xl"
    : "text-2xl";

  return (
    <div
      className={`flex h-full min-w-0 flex-col rounded-xl border p-5 ${cardClass} ${wideClass}`}
    >
      <div className={labelClass}>{label}</div>
      <div
        className={`mt-3 flex flex-1 items-end font-bold leading-snug ${valueSizeClass} ${valueClass}`}
      >
        <span
          className={
            clamp
              ? "line-clamp-2 break-words"
              : truncate
              ? "truncate"
              : ""
          }
          title={truncate || clamp ? String(value) : undefined}
        >
          {value}
        </span>
      </div>
    </div>
  );
}
