"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import BankaMutabakatV2Workspace from "./components/BankaMutabakatV2Workspace";
import { getCompanyDisplayName } from "@/src/utils/companies";
import { normalizeCompanyRecord, savePendingLucaRows } from "@/src/utils/companyCenter";
import {
  applyManualMatchToAnalysis,
  approveMutabakatMatch,
  BANK_OPTIONS,
  buildMissingMuavinLucaSuggestion,
  buildMutabakatExcelRows,
  buildMutabakatSummarySheetRows,
  filterMutabakatRows,
  groupMutabakatRows,
  parseBankEkstreSheet,
  parseLuca102MuavinSheet,
  recalculateMutabakatSummary,
  removeManualMatchFromAnalysis,
  runBankaMutabakat,
} from "@/src/utils/bankaMutabakat";
import { V2_FILTER, persistReconciliationMatch } from "@/src/utils/bankaMutabakatV2";
import { saveMutabakatManualMatch } from "@/src/utils/mutabakatMatchMemory";
import {
  buildStandardLucaTransferPayload,
  KAYNAK_TIPI,
} from "@/src/utils/standardLucaRow";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

const FLOW_STEPS = [
  "Firma seç",
  "Banka seç",
  "Banka ekstresi yükle",
  "Luca 102 muavin yükle",
  "Karşılaştır",
  "Mutabakat merkezi",
];

async function readExcelSheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

export default function BankaMutabakatPage() {
  const router = useRouter();
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany: selectedCompanyRaw,
  } = useCompanyList();

  const selectedCompany = useMemo(
    () => (selectedCompanyRaw ? normalizeCompanyRecord(selectedCompanyRaw) : null),
    [selectedCompanyRaw]
  );

  const [selectedBank, setSelectedBank] = useState("TEB");
  const [bankFileName, setBankFileName] = useState("");
  const [muavinFileName, setMuavinFileName] = useState("");
  const [bankRows, setBankRows] = useState([]);
  const [muavinRows, setMuavinRows] = useState([]);
  const [hasCompared, setHasCompared] = useState(false);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [search, setSearch] = useState("");
  const [v2Filter, setV2Filter] = useState(V2_FILTER.ALL);
  const [selectedBankTxnId, setSelectedBankTxnId] = useState("");
  const [selectedLedgerTxnId, setSelectedLedgerTxnId] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = (message, type) => setToast({ message, type });

  const matchContext = useMemo(
    () => ({
      bankId: selectedBank,
      company: selectedCompany || {},
      firmaId: selectedCompanyId,
    }),
    [selectedBank, selectedCompany, selectedCompanyId]
  );

  const bank102Account = useMemo(() => {
    const bankAccounts = selectedCompany?.bankAccounts || [];
    const matched = bankAccounts.find((bank) => {
      if (bank.isActive === false) return false;
      return String(bank.bankName || "")
        .toUpperCase()
        .includes(selectedBank.slice(0, 3));
    });
    return matched?.lucaAccountCode || "";
  }, [selectedCompany, selectedBank]);

  const currentStep = useMemo(() => {
    if (hasCompared && (bankRows.length || muavinRows.length)) return 6;
    if (bankRows.length && muavinRows.length) return 5;
    if (muavinRows.length) return 4;
    if (bankRows.length) return 3;
    if (selectedBank) return 2;
    if (selectedCompanyId) return 1;
    return 0;
  }, [
    hasCompared,
    bankRows.length,
    muavinRows.length,
    selectedBank,
    selectedCompanyId,
  ]);

  const analysis = comparisonResult;

  const resetComparison = () => {
    setHasCompared(false);
    setComparisonResult(null);
    setSelectedBankTxnId("");
    setSelectedLedgerTxnId("");
    setV2Filter(V2_FILTER.ALL);
  };

  const persistMatch = async (row, matchType = "manual") => {
    if (!selectedCompanyId || !row?.bankRow || !row?.muavinRow) return;

    await persistReconciliationMatch({
      company_id: selectedCompanyId,
      bank_id: selectedBank,
      bank_transaction_id: row.bankRow.id,
      ledger_transaction_id: row.muavinRow.id,
      match_type: matchType,
      match_score: row.guvenSkoru || 100,
      status: "matched",
      difference_amount: row.fark || 0,
      matched_by: "user",
    });
  };

  const handleBankFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const sheetRows = await readExcelSheet(file);
      const parsed = parseBankEkstreSheet(sheetRows, selectedBank);
      setBankRows(parsed);
      setBankFileName(file.name);
      resetComparison();
      showToast(`${parsed.length} banka satırı yüklendi`, "success");
    } catch (error) {
      showToast(error?.message || "Banka ekstresi okunamadı", "error");
      setBankRows([]);
      setBankFileName("");
      resetComparison();
    }

    event.target.value = "";
  };

  const handleMuavinFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const sheetRows = await readExcelSheet(file);
      const parsed = parseLuca102MuavinSheet(sheetRows, bank102Account);
      setMuavinRows(parsed);
      setMuavinFileName(file.name);
      resetComparison();
      showToast(`${parsed.length} muavin satırı yüklendi`, "success");
    } catch (error) {
      showToast(error?.message || "Muavin dosyası okunamadı", "error");
      setMuavinRows([]);
      setMuavinFileName("");
      resetComparison();
    }

    event.target.value = "";
  };

  const handleCompare = () => {
    if (!selectedCompanyId) {
      showToast("Karşılaştırma için firma seçmelisiniz", "error");
      return;
    }

    if (!bankRows.length) {
      showToast("Banka ekstresi yükleyin", "error");
      return;
    }

    if (!muavinRows.length) {
      showToast("Luca 102 muavin dosyası yükleyin", "error");
      return;
    }

    setHasCompared(true);
    setComparisonResult(
      runBankaMutabakat({
        bankRows,
        muavinRows,
        bankId: selectedBank,
        company: selectedCompany || {},
        firmaId: selectedCompanyId,
      })
    );
    setSelectedBankTxnId("");
    setSelectedLedgerTxnId("");
    setV2Filter(V2_FILTER.ALL);
    showToast("Karşılaştırma tamamlandı", "success");
  };

  const handleApproveMatch = (row) => {
    if (!row?.bankRow || !row?.muavinRow) return;

    saveMutabakatManualMatch(row.bankRow, row.muavinRow, matchContext);

    let approvedRow = row;
    setComparisonResult((current) => {
      if (!current) return current;

      const updatedRows = current.rows.map((item) => {
        if (item.id !== row.id) return item;
        approvedRow = approveMutabakatMatch(item);
        return approvedRow;
      });
      const grouped = groupMutabakatRows(updatedRows);

      return {
        ...current,
        rows: updatedRows,
        grouped,
        summary: recalculateMutabakatSummary(updatedRows, grouped, current.summary),
      };
    });

    persistMatch(approvedRow, "approved");
    showToast("Eşleşme onaylandı ve hafızaya alındı", "success");
  };

  const handleManualMatch = () => {
    const bankRow = bankRows.find((row) => row.id === selectedBankTxnId);
    const muavinRow = muavinRows.find((row) => row.id === selectedLedgerTxnId);

    if (!bankRow || !muavinRow) {
      showToast("Sol ve sağ panelden birer kayıt seçin", "error");
      return;
    }

    saveMutabakatManualMatch(bankRow, muavinRow, matchContext);

    let matchedRow = null;
    setComparisonResult((current) => {
      if (!current) return current;
      const next = applyManualMatchToAnalysis(current, bankRow, muavinRow, matchContext);
      matchedRow = next.rows.find(
        (row) => row.bankRow?.id === bankRow.id && row.muavinRow?.id === muavinRow.id
      );
      return next;
    });

    if (matchedRow) {
      persistMatch(matchedRow, "manual");
    }

    setSelectedBankTxnId("");
    setSelectedLedgerTxnId("");
    showToast("Manuel eşleştirme kaydedildi", "success");
  };

  const handleRemoveMatch = (resultRow) => {
    if (!resultRow) return;

    setComparisonResult((current) =>
      current ? removeManualMatchFromAnalysis(current, resultRow, matchContext) : current
    );
    setSelectedBankTxnId("");
    setSelectedLedgerTxnId("");
    showToast("Eşleşme kaldırıldı", "success");
  };

  const handleCreateVoucher = (bankPanelItem) => {
    const bankRow = bankPanelItem?.rawRow;
    if (!bankRow) return;

    if (!selectedCompanyId) {
      showToast("Önce firma seçmelisiniz", "error");
      return;
    }

    const lucaRows =
      bankPanelItem.resultRow?.suggestedLucaRows?.length > 0
        ? bankPanelItem.resultRow.suggestedLucaRows
        : buildMissingMuavinLucaSuggestion(bankRow, matchContext);

    if (!lucaRows.length) {
      showToast("Fiş önerisi oluşturulamadı", "error");
      return;
    }

    savePendingLucaRows(
      buildStandardLucaTransferPayload({
        firmaId: selectedCompanyId,
        companyName: getCompanyDisplayName(selectedCompany),
        kaynakTipi: KAYNAK_TIPI.BANKA,
        kaynakAdi: selectedBank,
        rows: lucaRows,
      })
    );

    showToast("Fiş Luca dönüştürücüye aktarıldı", "success");
    router.push("/muhasebe/luca-donusturucu");
  };

  const downloadMutabakatReport = (mode = "all") => {
    if (!analysis?.rows?.length) {
      showToast("Dışa aktarılacak sonuç yok", "error");
      return;
    }

    const rowsToExport = filterMutabakatRows(analysis.rows, {
      riskyOnly: mode === "risky",
      unmatchedOnly: mode === "unmatched",
    });

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(
      buildMutabakatSummarySheetRows(analysis, {
        firma: selectedCompany?.name || selectedCompanyId,
        bankId: selectedBank,
      })
    );
    const resultSheet = XLSX.utils.json_to_sheet(
      buildMutabakatExcelRows({ rows: rowsToExport })
    );

    XLSX.utils.book_append_sheet(workbook, summarySheet, "Özet");
    XLSX.utils.book_append_sheet(workbook, resultSheet, "Mutabakat");

    const suffix =
      mode === "unmatched"
        ? "Eslesmeyenler"
        : mode === "risky"
          ? "Riskliler"
          : "Tum_Sonuclar";

    XLSX.writeFile(
      workbook,
      `Banka_Mutabakat_${selectedBank}_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    showToast("Excel raporu indirildi", "success");
  };

  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white sm:p-8">
      {toast ? (
        <div
          role="status"
          className={`fixed top-4 right-4 z-[9999] rounded-lg border px-4 py-3 text-sm font-medium shadow-xl ${
            toast.type === "success"
              ? "border-emerald-700 bg-emerald-950 text-emerald-200"
              : "border-red-700 bg-red-950 text-red-200"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <MuhasebeMenu />

      <h1 className="mb-2 text-3xl font-bold sm:text-4xl">Banka Mutabakat Merkezi V2</h1>
      <p className="mb-6 max-w-4xl text-gray-400">
        Banka ekstresi ile Luca 102 muavin kayıtlarını görsel çift panelde karşılaştırın,
        eşleştirmeleri onaylayın ve eksik kayıtlar için mevcut Luca fiş altyapısını kullanın.
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        {FLOW_STEPS.map((step, index) => (
          <span
            key={step}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              index + 1 <= currentStep
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400"
            }`}
          >
            {index + 1}. {step}
          </span>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-5 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">1. Firma</span>
          <select
            value={selectedCompanyId}
            onChange={(event) => {
              setSelectedCompanyId(event.target.value);
              resetComparison();
            }}
            className={inputClassName}
          >
            <option value="">Firma seçin</option>
            <CompanySelectOptions companies={companies} />
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">2. Banka</span>
          <select
            value={selectedBank}
            onChange={(event) => {
              setSelectedBank(event.target.value);
              resetComparison();
            }}
            className={inputClassName}
          >
            {BANK_OPTIONS.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <div className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-gray-300">
            Luca 102 Hesap: {bank102Account || "Firma banka hesabı tanımlı değil"}
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <UploadCard
          step="3"
          title="Banka Ekstresi Excel"
          fileName={bankFileName}
          hint="TEB, Vakıfbank, Garanti, Ziraat, Kuveyt veya genel format"
          onChange={handleBankFile}
          count={bankRows.length}
        />
        <UploadCard
          step="4"
          title="Luca 102 Muavin Excel"
          fileName={muavinFileName}
          hint="Luca muavin veya fiş aktarım dosyası (102 hesap satırları)"
          onChange={handleMuavinFile}
          count={muavinRows.length}
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleCompare}
          disabled={!bankRows.length || !muavinRows.length}
          className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          5. Karşılaştır
        </button>
      </div>

      {analysis ? (
        <BankaMutabakatV2Workspace
          analysis={analysis}
          v2Filter={v2Filter}
          onV2FilterChange={setV2Filter}
          search={search}
          onSearchChange={setSearch}
          selectedBankTxnId={selectedBankTxnId}
          selectedLedgerTxnId={selectedLedgerTxnId}
          onSelectBank={setSelectedBankTxnId}
          onSelectLedger={setSelectedLedgerTxnId}
          onManualMatch={handleManualMatch}
          onRemoveMatch={handleRemoveMatch}
          onApproveMatch={handleApproveMatch}
          onCreateVoucher={handleCreateVoucher}
          onExportAll={() => downloadMutabakatReport("all")}
          onExportUnmatched={() => downloadMutabakatReport("unmatched")}
          onExportRisky={() => downloadMutabakatReport("risky")}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/60 p-10 text-center text-gray-400">
          Her iki Excel dosyasını yükledikten sonra <strong>Karşılaştır</strong>{" "}
          butonuna basın. Mutabakat merkezi burada açılacak.
        </div>
      )}
    </main>
  );
}

function UploadCard({ step, title, fileName, hint, onChange, count }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <h2 className="mb-2 text-xl font-semibold">
        {step}. {title}
      </h2>
      <p className="mb-4 text-sm text-gray-400">{hint}</p>

      <label className="inline-flex cursor-pointer rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-700">
        Excel Yükle
        <input type="file" accept=".xlsx,.xls" onChange={onChange} className="hidden" />
      </label>

      <div className="mt-4 space-y-1 text-sm text-gray-400">
        <div>{fileName || "Henüz dosya seçilmedi"}</div>
        {count ? <div className="text-emerald-300">{count} satır okundu</div> : null}
      </div>
    </div>
  );
}
