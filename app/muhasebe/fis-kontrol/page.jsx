"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";

const COLUMN_ALIASES = {
  fisNo: ["Fiş No", "Fis No"],
  fisTarihi: ["Fiş Tarihi", "Fis Tarihi", "Tarih"],
  fisAciklama: ["Fiş Açıklama", "Fis Aciklama"],
  hesapKodu: ["Hesap Kodu", "HesapKodu"],
  evrakNo: ["Evrak No", "Belge No", "EvrakNo"],
  detayAciklama: ["Detay Açıklama", "Detay Aciklama", "Açıklama"],
  borc: ["Borç", "Borc"],
  alacak: ["Alacak"],
};

function compactText(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(/\s+/g, "");
}

function getRowValue(row, aliases) {
  for (const alias of aliases) {
    const foundKey = Object.keys(row || {}).find(
      (key) => compactText(key) === compactText(alias)
    );

    if (foundKey !== undefined) {
      return row[foundKey];
    }
  }

  return "";
}

function parseMoney(value) {
  if (typeof value === "number") return value;

  const text = String(value || "")
    .replaceAll("TL", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const number = Number(text);
  return Number.isNaN(number) ? 0 : number;
}

function formatMoney(value) {
  if (!value) return "0,00";
  return value.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeRow(row, rowNo) {
  const borc = parseMoney(getRowValue(row, COLUMN_ALIASES.borc));
  const alacak = parseMoney(getRowValue(row, COLUMN_ALIASES.alacak));
  const detayAciklama = String(getRowValue(row, COLUMN_ALIASES.detayAciklama) || "").trim();
  const fisAciklama = String(getRowValue(row, COLUMN_ALIASES.fisAciklama) || "").trim();

  return {
    rowNo,
    fisNo: String(getRowValue(row, COLUMN_ALIASES.fisNo) || "").trim(),
    fisTarihi: String(getRowValue(row, COLUMN_ALIASES.fisTarihi) || "").trim(),
    fisAciklama,
    hesapKodu: String(getRowValue(row, COLUMN_ALIASES.hesapKodu) || "").trim(),
    evrakNo: String(getRowValue(row, COLUMN_ALIASES.evrakNo) || "").trim(),
    detayAciklama,
    aciklama: detayAciklama || fisAciklama,
    borc,
    alacak,
    tutar: borc > 0 ? borc : alacak,
  };
}

function analyzeLucaRows(rawRows) {
  const rows = rawRows.map((row, index) => normalizeRow(row, index + 2));
  const issues = [];

  const duplicateMovementKeys = new Map();
  const duplicateEvrakNos = new Map();
  const fisTotals = new Map();

  rows.forEach((row) => {
    if (!row.hesapKodu) {
      issues.push({
        rowNo: row.rowNo,
        type: "Boş Hesap Kodu",
        severity: "error",
        description: "Hesap kodu alanı boş.",
        hesapKodu: "—",
        tutar: formatMoney(row.tutar),
      });
    }

    if (!row.aciklama) {
      issues.push({
        rowNo: row.rowNo,
        type: "Boş Açıklama",
        severity: "error",
        description: "Detay açıklama ve fiş açıklama alanları boş.",
        hesapKodu: row.hesapKodu || "—",
        tutar: formatMoney(row.tutar),
      });
    }

    if (!row.fisTarihi) {
      issues.push({
        rowNo: row.rowNo,
        type: "Boş Tarih",
        severity: "error",
        description: "Fiş tarihi alanı boş.",
        hesapKodu: row.hesapKodu || "—",
        tutar: formatMoney(row.tutar),
      });
    }

    if (row.borc <= 0 && row.alacak <= 0) {
      issues.push({
        rowNo: row.rowNo,
        type: "Boş Tutar",
        severity: "error",
        description: "Borç ve alacak tutarları boş veya sıfır.",
        hesapKodu: row.hesapKodu || "—",
        tutar: "0,00",
      });
    }

    const movementKey = [
      compactText(row.fisTarihi),
      compactText(row.hesapKodu),
      row.tutar.toFixed(2),
      compactText(row.aciklama),
    ].join("|");

    if (movementKey.replace(/\|/g, "").length > 0) {
      const previous = duplicateMovementKeys.get(movementKey);

      if (previous) {
        issues.push({
          rowNo: row.rowNo,
          type: "Mükerrer Satır",
          severity: "warning",
          description: `Aynı tarih, hesap, tutar ve açıklama ${previous}. satır ile tekrar ediyor.`,
          hesapKodu: row.hesapKodu || "—",
          tutar: formatMoney(row.tutar),
        });
      } else {
        duplicateMovementKeys.set(movementKey, row.rowNo);
      }
    }

    if (row.evrakNo) {
      const evrakKey = compactText(row.evrakNo);
      const previousEvrak = duplicateEvrakNos.get(evrakKey);

      if (previousEvrak) {
        issues.push({
          rowNo: row.rowNo,
          type: "Mükerrer Belge No",
          severity: "warning",
          description: `Belge no "${row.evrakNo}" ${previousEvrak}. satırda da kullanılmış.`,
          hesapKodu: row.hesapKodu || "—",
          tutar: formatMoney(row.tutar),
        });
      } else {
        duplicateEvrakNos.set(evrakKey, row.rowNo);
      }
    }

    const fisKey = row.fisNo || `ROW-${row.rowNo}`;

    if (!fisTotals.has(fisKey)) {
      fisTotals.set(fisKey, {
        fisNo: row.fisNo || "—",
        firstRowNo: row.rowNo,
        borc: 0,
        alacak: 0,
      });
    }

    const fisTotal = fisTotals.get(fisKey);
    fisTotal.borc += row.borc;
    fisTotal.alacak += row.alacak;
  });

  let unbalancedFisCount = 0;

  fisTotals.forEach((fisTotal) => {
    const diff = Math.abs(fisTotal.borc - fisTotal.alacak);

    if (diff > 0.01) {
      unbalancedFisCount += 1;

      issues.push({
        rowNo: fisTotal.firstRowNo,
        type: "Denge Hatası",
        severity: "error",
        description: `Fiş ${fisTotal.fisNo}: borç ${formatMoney(fisTotal.borc)} / alacak ${formatMoney(fisTotal.alacak)} — fark ${formatMoney(diff)}.`,
        hesapKodu: "—",
        tutar: formatMoney(diff),
      });
    }
  });

  const errorRowNos = new Set(
    issues.filter((issue) => issue.severity === "error").map((issue) => issue.rowNo)
  );

  return {
    rows,
    issues,
    summary: {
      totalRows: rows.length,
      errorRowCount: errorRowNos.size,
      warningCount: issues.filter((issue) => issue.severity === "warning").length,
      balanceStatus:
        unbalancedFisCount === 0
          ? "Dengeli"
          : `${unbalancedFisCount} fiş dengesiz`,
      isBalanced: unbalancedFisCount === 0,
    },
  };
}

export default function FisKontrolPage() {
  const [fileName, setFileName] = useState("");
  const [analysis, setAnalysis] = useState(null);

  const errorIssues = useMemo(
    () => analysis?.issues.filter((issue) => issue.severity === "error") || [],
    [analysis]
  );

  const warningIssues = useMemo(
    () => analysis?.issues.filter((issue) => issue.severity === "warning") || [],
    [analysis]
  );

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      setAnalysis(analyzeLucaRows(jsonRows));
    } catch {
      setAnalysis(null);
      alert("Dosya okunamadı. Lütfen geçerli bir Luca fiş Excel dosyası yükleyin.");
    }

    event.target.value = "";
  };

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      <MuhasebeMenu />

      <h1 className="mb-2 text-4xl font-bold">Fiş Kontrol Merkezi v1</h1>
      <p className="mb-8 text-gray-400">
        Luca fiş Excel dosyalarında hesap, tutar, denge ve mükerrer kayıt
        kontrolleri.
      </p>

      <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-2xl font-semibold">Luca Fiş Dosyası</h2>

        <p className="mb-4 text-sm text-gray-400">
          .xlsx veya .xls formatında Luca fiş aktarım dosyası yükleyin.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <label className="cursor-pointer rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-700">
            Excel Yükle
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFile}
              className="hidden"
            />
          </label>

          <span className="text-gray-400">
            {fileName || "Henüz dosya seçilmedi"}
          </span>
        </div>
      </div>

      {analysis && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Toplam Satır"
              value={analysis.summary.totalRows}
              tone="neutral"
            />
            <SummaryCard
              title="Hatalı Satır"
              value={analysis.summary.errorRowCount}
              tone={analysis.summary.errorRowCount > 0 ? "error" : "success"}
            />
            <SummaryCard
              title="Uyarı Sayısı"
              value={analysis.summary.warningCount}
              tone={analysis.summary.warningCount > 0 ? "warning" : "success"}
            />
            <SummaryCard
              title="Denge Durumu"
              value={analysis.summary.balanceStatus}
              tone={analysis.summary.isBalanced ? "success" : "error"}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <IssuePanel title="Hatalar" issues={errorIssues} emptyText="Hata bulunamadı." />
            <IssuePanel
              title="Uyarılar"
              issues={warningIssues}
              emptyText="Uyarı bulunamadı."
            />
          </div>

          <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold">Yüklenen Satırlar</h2>
              <span className="rounded-lg bg-gray-800 px-3 py-1 text-sm text-gray-300">
                {analysis.rows.length} satır
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-gray-800 text-gray-300">
                  <tr>
                    <th className="p-3 text-left">Satır</th>
                    <th className="p-3 text-left">Fiş No</th>
                    <th className="p-3 text-left">Tarih</th>
                    <th className="p-3 text-left">Hesap Kodu</th>
                    <th className="p-3 text-left">Açıklama</th>
                    <th className="p-3 text-right">Borç</th>
                    <th className="p-3 text-right">Alacak</th>
                    <th className="p-3 text-left">Belge No</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rows.slice(0, 100).map((row) => (
                    <tr key={`row-${row.rowNo}`} className="border-t border-gray-800">
                      <td className="p-3">{row.rowNo}</td>
                      <td className="p-3">{row.fisNo || "—"}</td>
                      <td className="p-3">{row.fisTarihi || "—"}</td>
                      <td className="p-3">{row.hesapKodu || "—"}</td>
                      <td className="p-3">{row.aciklama || "—"}</td>
                      <td className="p-3 text-right">{formatMoney(row.borc)}</td>
                      <td className="p-3 text-right">{formatMoney(row.alacak)}</td>
                      <td className="p-3">{row.evrakNo || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {analysis.rows.length > 100 && (
              <p className="mt-4 text-sm text-gray-400">
                İlk 100 satır gösteriliyor. Toplam {analysis.rows.length} satır
                analiz edildi.
              </p>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function SummaryCard({ title, value, tone }) {
  const toneClasses = {
    neutral: "border-gray-700 bg-gray-950 text-white",
    success: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
    warning: "border-amber-800 bg-amber-950/40 text-amber-300",
    error: "border-red-800 bg-red-950/40 text-red-300",
  };

  return (
    <div
      className={`rounded-2xl border p-5 ${toneClasses[tone] || toneClasses.neutral}`}
    >
      <div className="text-sm text-gray-400">{title}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

function IssuePanel({ title, issues, emptyText }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold">{title}</h2>
        <span className="rounded-lg bg-gray-800 px-3 py-1 text-sm text-gray-300">
          {issues.length}
        </span>
      </div>

      {issues.length === 0 ? (
        <p className="text-gray-400">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {issues.map((issue, index) => (
            <div
              key={`${issue.type}-${issue.rowNo}-${index}`}
              className="rounded-xl border border-gray-800 bg-gray-950 p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-gray-800 px-2 py-1 text-xs font-semibold">
                  Satır {issue.rowNo}
                </span>
                <span
                  className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                    issue.severity === "error"
                      ? "bg-red-900/60 text-red-200"
                      : "bg-amber-900/60 text-amber-200"
                  }`}
                >
                  {issue.type}
                </span>
              </div>

              <p className="text-sm text-gray-300">{issue.description}</p>

              <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-gray-400 sm:grid-cols-2">
                <div>Hesap Kodu: {issue.hesapKodu}</div>
                <div>Tutar: {issue.tutar}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
