"use client";

/**
 * StandardLuca domain preview table.
 * Unified grid altyapısı: AnnveroUnifiedEditableGrid + useStandardLucaGridColumns.
 * Bu bileşen domain-özel kontrol/validation katmanını korur.
 */
import { Fragment, useMemo, useState } from "react";
import PreviewVoucherDetailPanel from "./PreviewVoucherDetailPanel";
import { DOCUMENT_TYPE_OPTIONS, buildStandardLucaRowEditDraft } from "@/src/utils/previewRowEdit";
import { validatePreviewForExport } from "@/src/utils/previewExportValidation";
import { MUKERRER_RISK_SEVIYE } from "@/src/utils/duplicateRiskAnalysis";
import {
  createEmptyStandardLucaRow,
  finalizeStandardLucaRow,
} from "@/src/utils/standardLucaRow";

const cellInputClassName =
  "w-full min-w-[88px] rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500";

export default function EditableStandardLucaPreviewTable({
  rows,
  onRowsChange,
  displayedRows,
  showKaynakColumn = false,
  createRowContext = {},
  exportValidation = null,
  renderKontrolCell,
  onSaveAdvancedEdit,
  onAccountFieldChange,
  isSavingAdvancedEdit = false,
  showAdvancedEdit = true,
}) {
  const [editingRowId, setEditingRowId] = useState(null);
  const [draftRow, setDraftRow] = useState(null);

  // Büyük listelerde (1000+ satır) tüm satırı validate etmek beyaz ekrana düşürür.
  // Canlı validasyon yalnızca ekranda görünen satırlar üzerinden yapılır;
  // export doğrulaması exportExcel anında full set ile çalışır.
  const liveValidation = useMemo(() => {
    const source =
      Array.isArray(displayedRows) && displayedRows.length > 0 && rows.length > 200
        ? displayedRows
        : rows;
    try {
      return validatePreviewForExport(source || []);
    } catch (error) {
      console.error("[EditableStandardLucaPreviewTable] validation failed", error);
      return {
        rowErrors: [],
        globalErrors: [error?.message || "Önizleme validasyonu başarısız"],
        hasBlockingErrors: false,
        hasWarnings: true,
        blockingErrorCount: 0,
        warningCount: 1,
      };
    }
  }, [rows, displayedRows]);

  const validation = exportValidation || liveValidation;

  const rowErrorById = useMemo(() => {
    const map = new Map();
    for (const item of validation.rowErrors || []) {
      if (item.rowId) map.set(item.rowId, item.errors);
    }
    return map;
  }, [validation.rowErrors]);

  const rowWarningById = useMemo(() => {
    const map = new Map();
    for (const item of validation.rowErrors || []) {
      if (item.rowId) map.set(item.rowId, item.warnings);
    }
    return map;
  }, [validation.rowErrors]);

  const rowDuplicateRiskById = useMemo(() => {
    const map = new Map();
    for (const item of validation.rowErrors || []) {
      if (item.rowId && item.duplicateRisk) {
        map.set(item.rowId, item.duplicateRisk);
      }
    }
    return map;
  }, [validation.rowErrors]);

  const patchRow = (rowId, patch, options = {}) => {
    const { trackAccountMemory = false } = options;

    onRowsChange(
      rows.map((row) => {
        if (row.id !== rowId) return row;

        const updatedRow = finalizeStandardLucaRow({
          ...row,
          ...patch,
          manuallyEdited: true,
          ...(trackAccountMemory
            ? { hafizaGuvenSkoru: 100, accountMemoryAutoFilled: false }
            : {}),
        });

        if (trackAccountMemory && onAccountFieldChange) {
          onAccountFieldChange(updatedRow);
        }

        return updatedRow;
      })
    );
  };

  const handleAddRow = () => {
    const nextFisNo =
      rows.reduce((max, row) => Math.max(max, Number(row.fisNo) || 0), 0) + 1;
    const newRow = createEmptyStandardLucaRow({
      ...createRowContext,
      nextIndex: rows.length + 1,
      fisNo: nextFisNo,
    });
    onRowsChange([...rows, newRow]);
  };

  const handleDeleteRow = (row) => {
    onRowsChange(rows.filter((item) => item.id !== row.id));
    if (editingRowId === row.id) {
      setEditingRowId(null);
      setDraftRow(null);
    }
  };

  const openAdvancedEdit = (row, draftBuilder) => {
    if (editingRowId === row.id) {
      setEditingRowId(null);
      setDraftRow(null);
      return;
    }
    setEditingRowId(row.id);
    setDraftRow(draftBuilder(row));
  };

  const cancelAdvancedEdit = () => {
    setEditingRowId(null);
    setDraftRow(null);
  };

  const saveAdvancedEdit = async () => {
    if (!editingRowId || !draftRow || !onSaveAdvancedEdit) return;
    const updated = await onSaveAdvancedEdit(editingRowId, draftRow);
    if (updated) {
      onRowsChange(rows.map((row) => (row.id === editingRowId ? updated : row)));
      cancelAdvancedEdit();
    }
  };

  const columnCount =
    14 + (showKaynakColumn ? 1 : 0) + (renderKontrolCell ? 1 : 0);

  const showBlockingBanner =
    exportValidation?.hasBlockingErrors && exportValidation?.blockingMessages?.length;

  const duplicateSummary = validation.duplicateAnalysis?.summary;

  return (
    <div className="space-y-4">
      {duplicateSummary?.hasCritical || duplicateSummary?.highCount ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            duplicateSummary?.hasCritical
              ? "border-red-700/60 bg-red-950/30 text-red-100"
              : "border-orange-700/60 bg-orange-950/25 text-orange-100"
          }`}
        >
          <p className="font-semibold">Mükerrer risk özeti</p>
          <p className="mt-1 text-xs opacity-90">
            {duplicateSummary.criticalCount > 0
              ? `${duplicateSummary.criticalCount} kritik, `
              : ""}
            {duplicateSummary.highCount > 0
              ? `${duplicateSummary.highCount} yüksek, `
              : ""}
            {duplicateSummary.mediumCount > 0
              ? `${duplicateSummary.mediumCount} orta, `
              : ""}
            {duplicateSummary.lowCount} düşük risk.
            {duplicateSummary.hasCritical
              ? " Kritik mükerrer kayıtlar Excel oluşturmayı engeller."
              : duplicateSummary.highCount > 0
                ? " Yüksek riskli satırlar export öncesi uyarı verir."
                : ""}
          </p>
        </div>
      ) : null}

      {showBlockingBanner ? (
        <div className="rounded-xl border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          <p className="font-semibold">Excel oluşturulamadı — lütfen hataları düzeltin:</p>
          {exportValidation.globalErrors?.length ? (
            <ul className="mt-2 list-inside list-disc">
              {exportValidation.globalErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
          <ul className="mt-2 list-inside list-disc">
            {(exportValidation.blockingMessages || []).slice(0, 12).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-400">
          Satırları tabloda düzenleyebilir, silebilir veya yeni satır ekleyebilirsiniz.
        </p>
        <button
          type="button"
          onClick={handleAddRow}
          className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-900/50"
        >
          + Yeni Satır
        </button>
      </div>

      <div className="overflow-auto">
        <table className="w-full min-w-[1900px] text-sm">
          <thead className="bg-gray-800 text-gray-300">
            <tr>
              <th className="p-3 text-left">Fiş No</th>
              <th className="p-3 text-left">Tarih</th>
              {showKaynakColumn ? <th className="p-3 text-left">Kaynak</th> : null}
              <th className="p-3 text-left">Açıklama</th>
              <th className="p-3 text-left">Hesap Kodu</th>
              <th className="p-3 text-left">Hesap Adı</th>
              <th className="p-3 text-center">Güven</th>
              <th className="p-3 text-left">Belge Türü</th>
              <th className="p-3 text-right">Borç</th>
              <th className="p-3 text-right">Alacak</th>
              <th className="p-3 text-left">Karşı Hesap</th>
              {renderKontrolCell ? <th className="p-3 text-left">Kontrol</th> : null}
              <th className="p-3 text-center">Mükerrer</th>
              <th className="p-3 text-left">Hatalar</th>
              <th className="p-3 text-left">Uyarılar</th>
              <th className="p-3 text-center">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="p-6 text-center text-gray-400">
                  Arama veya filtreye uygun satır bulunamadı.
                </td>
              </tr>
            ) : (
              displayedRows.map((row) => {
                const errors = rowErrorById.get(row.id) || [];
                const warnings = rowWarningById.get(row.id) || [];
                const duplicateRisk = rowDuplicateRiskById.get(row.id);
                const duplicateScore = duplicateRisk?.score || 0;
                const isCriticalDuplicate = Boolean(duplicateRisk?.isCritical);
                const isHighDuplicate =
                  !isCriticalDuplicate &&
                  (duplicateRisk?.level === MUKERRER_RISK_SEVIYE.YUKSEK ||
                    duplicateScore >= 70);
                const isMediumDuplicate =
                  duplicateRisk?.level === MUKERRER_RISK_SEVIYE.ORTA;

                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`border-t border-gray-800 ${
                        errors.length || isCriticalDuplicate
                          ? "border-l-4 border-l-red-500 bg-red-950/25"
                          : isHighDuplicate
                            ? "border-l-4 border-l-orange-500 bg-orange-950/20"
                            : isMediumDuplicate
                              ? "bg-amber-950/10"
                              : warnings.length
                                ? "bg-amber-950/10"
                                : ""
                      }`}
                    >
                      <td className="p-2">
                        <input
                          value={row.fisNo ?? ""}
                          onChange={(event) =>
                            patchRow(row.id, { fisNo: event.target.value })
                          }
                          className={cellInputClassName}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          value={row.fisTarihi || ""}
                          onChange={(event) =>
                            patchRow(row.id, {
                              fisTarihi: event.target.value,
                              evrakTarihi: event.target.value,
                            })
                          }
                          placeholder="GG.AA.YYYY"
                          className={cellInputClassName}
                        />
                      </td>
                      {showKaynakColumn ? (
                        <td className="p-3 text-xs text-gray-400">
                          {row.kaynakAdi || row.kaynakTipi || "—"}
                        </td>
                      ) : null}
                      <td className="p-2">
                        <input
                          value={row.detayAciklama || row.fisAciklama || ""}
                          onChange={(event) =>
                            patchRow(row.id, {
                              detayAciklama: event.target.value,
                              fisAciklama: event.target.value,
                              aciklama: event.target.value,
                            })
                          }
                          className={`${cellInputClassName} min-w-[180px]`}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          value={row.hesapKodu || ""}
                          onChange={(event) =>
                            patchRow(
                              row.id,
                              { hesapKodu: event.target.value },
                              { trackAccountMemory: true }
                            )
                          }
                          className={`${cellInputClassName} font-mono`}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          value={row.hesapAdi || ""}
                          onChange={(event) =>
                            patchRow(
                              row.id,
                              { hesapAdi: event.target.value },
                              { trackAccountMemory: true }
                            )
                          }
                          className={`${cellInputClassName} min-w-[140px]`}
                        />
                      </td>
                      <td className="p-3 text-center">
                        {row.hafizaGuvenSkoru ? (
                          <span
                            className={`inline-flex min-w-[42px] justify-center rounded-full px-2 py-1 text-[11px] font-semibold ${
                              row.hafizaGuvenSkoru >= 100
                                ? "bg-emerald-900/60 text-emerald-200"
                                : row.hafizaGuvenSkoru >= 80
                                  ? "bg-sky-900/60 text-sky-200"
                                  : "bg-amber-900/60 text-amber-200"
                            }`}
                            title={
                              row.accountMemoryAutoFilled
                                ? "Hesap hafızasından otomatik dolduruldu"
                                : "Hesap hafızası eşleşmesi"
                            }
                          >
                            {row.hafizaGuvenSkoru}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        <select
                          value={row.belgeTuru || ""}
                          onChange={(event) =>
                            patchRow(row.id, { belgeTuru: event.target.value })
                          }
                          className={cellInputClassName}
                        >
                          <option value="">Seçiniz</option>
                          {DOCUMENT_TYPE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          value={row.borc ?? ""}
                          onChange={(event) =>
                            patchRow(row.id, { borc: event.target.value, alacak: "" })
                          }
                          className={`${cellInputClassName} text-right`}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          value={row.alacak ?? ""}
                          onChange={(event) =>
                            patchRow(row.id, { alacak: event.target.value, borc: "" })
                          }
                          className={`${cellInputClassName} text-right`}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          value={row.karsiHesapKodu || ""}
                          onChange={(event) =>
                            patchRow(row.id, { karsiHesapKodu: event.target.value })
                          }
                          className={`${cellInputClassName} font-mono`}
                        />
                      </td>
                      {renderKontrolCell ? (
                        <td className="p-3">{renderKontrolCell(row)}</td>
                      ) : null}
                      <td className="p-3 text-center align-top">
                        {duplicateScore > 0 ? (
                          <div className="space-y-1">
                            <span
                              className={`inline-flex min-w-[42px] justify-center rounded-full px-2 py-1 text-[11px] font-semibold ${
                                isCriticalDuplicate
                                  ? "bg-red-900/70 text-red-100"
                                  : isHighDuplicate
                                    ? "bg-orange-900/70 text-orange-100"
                                    : isMediumDuplicate
                                      ? "bg-amber-900/60 text-amber-100"
                                      : "bg-gray-800 text-gray-300"
                              }`}
                              title={duplicateRisk?.level || "Düşük"}
                            >
                              {duplicateScore}
                            </span>
                            <div className="text-[10px] text-gray-400">
                              {duplicateRisk?.level || "—"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">—</span>
                        )}
                      </td>
                      <td className="p-3 align-top">
                        {errors.length ? (
                          <ul className="space-y-1 text-[11px] text-red-300">
                            {errors.map((error) => (
                              <li key={error}>• {error}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs text-gray-500">—</span>
                        )}
                      </td>
                      <td className="p-3 align-top">
                        {warnings.length ? (
                          <ul className="space-y-1 text-[11px] text-amber-300">
                            {warnings.map((warning) => (
                              <li key={warning}>• {warning}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs text-gray-500">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-2">
                          {showAdvancedEdit && onSaveAdvancedEdit ? (
                            <button
                              type="button"
                              onClick={() => openAdvancedEdit(row, buildStandardLucaRowEditDraft)}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                                editingRowId === row.id
                                  ? "border-indigo-500 bg-indigo-950/60 text-indigo-200"
                                  : "border-gray-700 bg-gray-950 text-gray-300 hover:border-indigo-500 hover:text-white"
                              }`}
                            >
                              Detay
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(row)}
                            className="rounded-lg border border-red-700/60 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-950/60"
                          >
                            Sil
                          </button>
                        </div>
                      </td>
                    </tr>

                    {showAdvancedEdit &&
                    onSaveAdvancedEdit &&
                    editingRowId === row.id &&
                    draftRow ? (
                      <tr className="border-t border-gray-800">
                        <td colSpan={columnCount} className="p-4">
                          <PreviewVoucherDetailPanel
                            variant="standardLuca"
                            draft={draftRow}
                            onChange={setDraftRow}
                            onSave={saveAdvancedEdit}
                            onCancel={cancelAdvancedEdit}
                            isSaving={isSavingAdvancedEdit}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
