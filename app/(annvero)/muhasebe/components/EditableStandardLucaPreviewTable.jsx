"use client";

/**
 * StandardLuca domain preview table.
 * Unified grid altyapısı: AnnveroUnifiedEditableGrid + useStandardLucaGridColumns.
 * Bu bileşen domain-özel kontrol/validation katmanını korur.
 */
import { Fragment, useMemo, useState } from "react";
import PreviewVoucherDetailPanel from "./PreviewVoucherDetailPanel";
import { PreviewClampList, PreviewClampText, PreviewRiskBadge } from "./PreviewClampCell";
import {
  annveroPreviewRowClass,
  annveroTableScrollWrap,
  annveroTableStickyRightTd,
  annveroTableStickyRightTh,
} from "@/src/styles/annveroDesign";
import { DOCUMENT_TYPE_OPTIONS, buildStandardLucaRowEditDraft } from "@/src/utils/previewRowEdit";
import { validatePreviewForExport } from "@/src/utils/previewExportValidation";
import { MUKERRER_RISK_SEVIYE } from "@/src/utils/duplicateRiskAnalysis";
import {
  createEmptyStandardLucaRow,
  finalizeStandardLucaRow,
} from "@/src/utils/standardLucaRow";

const cellInputClassName =
  "h-8 w-full min-w-0 truncate rounded-md border border-slate-700/80 bg-slate-950 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500";

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
  onCoreTeachClick,
  showCoreTeachForRow,
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
      {duplicateSummary?.hasCritical ||
      duplicateSummary?.suspiciousCount > 0 ||
      duplicateSummary?.expectedDoubleEntryPairs > 0 ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            duplicateSummary?.hasCritical
              ? "border-red-700/60 bg-red-950/30 text-red-100"
              : "border-slate-700/60 bg-slate-950/40 text-slate-200"
          }`}
        >
          <p className="font-semibold">Mükerrer risk özeti</p>
          <p className="mt-1 text-xs opacity-90">
            Kritik gerçek mükerrer: {duplicateSummary.criticalCount || 0}
            {" · "}
            Şüpheli benzer: {duplicateSummary.suspiciousCount || 0}
            {" · "}
            Beklenen borç/alacak çiftleri:{" "}
            {duplicateSummary.expectedDoubleEntryPairs || 0}
            {duplicateSummary.hasCritical
              ? " — Kritik mükerrerler Excel’i engeller."
              : " — Benzer kayıtlar bilgilendirme amaçlıdır; çift taraflı fiş mükerrer sayılmaz."}
          </p>
        </div>
      ) : null}

      {showBlockingBanner ? (
        <div className="rounded-xl border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          <p className="font-semibold">Excel oluşturulamadı — özet:</p>
          {exportValidation.errorCategoryCounts ? (
            <ul className="mt-2 list-inside list-disc text-xs">
              <li>Eksik hesap: {exportValidation.errorCategoryCounts.eksikHesap || 0}</li>
              <li>Dengesiz fiş: {exportValidation.errorCategoryCounts.dengesizFis || 0}</li>
              <li>
                Kritik mükerrer: {exportValidation.errorCategoryCounts.kritikMukerrer || 0}
              </li>
              <li>
                Eksik tarih/tutar: {exportValidation.errorCategoryCounts.eksikTarihTutar || 0}
              </li>
              <li>
                Geçersiz belge: {exportValidation.errorCategoryCounts.gecersizBelge || 0}
              </li>
            </ul>
          ) : null}
          {exportValidation.globalErrors?.length ? (
            <ul className="mt-2 list-inside list-disc">
              {exportValidation.globalErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs opacity-80">
            Toplam engel: {exportValidation.blockingErrorCount || (exportValidation.blockingMessages || []).length}
            {" · "}İlk örnekler:
          </p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {(exportValidation.blockingMessages || []).slice(0, 10).map((error) => (
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

      <div className={annveroTableScrollWrap}>
        <table className="annvero-table-fixed-rows w-full min-w-[1680px] text-sm">
          <thead className="bg-slate-900 text-slate-300">
            <tr className={annveroPreviewRowClass}>
              <th className="p-2 text-left text-[11px] font-semibold uppercase">Fiş No</th>
              <th className="p-2 text-left text-[11px] font-semibold uppercase">Tarih</th>
              {showKaynakColumn ? (
                <th className="p-2 text-left text-[11px] font-semibold uppercase">Kaynak</th>
              ) : null}
              <th className="min-w-[160px] p-2 text-left text-[11px] font-semibold uppercase">
                Açıklama
              </th>
              <th className="p-2 text-left text-[11px] font-semibold uppercase">Hesap Kodu</th>
              <th className="p-2 text-left text-[11px] font-semibold uppercase">Hesap Adı</th>
              <th className="p-2 text-center text-[11px] font-semibold uppercase">Güven</th>
              <th className="p-2 text-left text-[11px] font-semibold uppercase">Belge Türü</th>
              <th className="p-2 text-right text-[11px] font-semibold uppercase">Borç</th>
              <th className="p-2 text-right text-[11px] font-semibold uppercase">Alacak</th>
              <th className="p-2 text-left text-[11px] font-semibold uppercase">Karşı Hesap</th>
              {renderKontrolCell ? (
                <th className="min-w-[140px] p-2 text-left text-[11px] font-semibold uppercase">
                  Kontrol
                </th>
              ) : null}
              <th className="p-2 text-center text-[11px] font-semibold uppercase">Mükerrer</th>
              <th className="min-w-[120px] p-2 text-left text-[11px] font-semibold uppercase">
                Hatalar
              </th>
              <th className="min-w-[120px] p-2 text-left text-[11px] font-semibold uppercase">
                Uyarılar
              </th>
              <th className={`p-2 text-center text-[11px] font-semibold uppercase ${annveroTableStickyRightTh}`}>
                İşlem
              </th>
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

                const rowSurfaceClass = errors.length || isCriticalDuplicate
                  ? "border-l-4 border-l-red-500 bg-red-950/25"
                  : isHighDuplicate
                    ? "border-l-4 border-l-orange-500 bg-orange-950/20"
                    : isMediumDuplicate
                      ? "bg-amber-950/10"
                      : warnings.length
                        ? "bg-amber-950/10"
                        : "bg-slate-950/70";

                return (
                  <Fragment key={row.id}>
                    <tr className={`${annveroPreviewRowClass} border-t border-slate-800/80 ${rowSurfaceClass}`}>
                      <td className="p-1.5">
                        <input
                          value={row.fisNo ?? ""}
                          onChange={(event) =>
                            patchRow(row.id, { fisNo: event.target.value })
                          }
                          className={cellInputClassName}
                        />
                      </td>
                      <td className="p-1.5">
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
                        <td className="p-1.5">
                          <PreviewClampText
                            text={row.kaynakAdi || row.kaynakTipi}
                            className="text-slate-400"
                          />
                        </td>
                      ) : null}
                      <td className="p-1.5">
                        <input
                          value={row.detayAciklama || row.fisAciklama || ""}
                          onChange={(event) =>
                            patchRow(row.id, {
                              detayAciklama: event.target.value,
                              fisAciklama: event.target.value,
                              aciklama: event.target.value,
                            })
                          }
                          title={row.detayAciklama || row.fisAciklama || ""}
                          className={cellInputClassName}
                        />
                      </td>
                      <td className="p-1.5">
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
                      <td className="p-1.5">
                        <input
                          value={row.hesapAdi || ""}
                          onChange={(event) =>
                            patchRow(
                              row.id,
                              { hesapAdi: event.target.value },
                              { trackAccountMemory: true }
                            )
                          }
                          title={row.hesapAdi || ""}
                          className={cellInputClassName}
                        />
                      </td>
                      <td className="p-1.5 text-center">
                        {row.hafizaGuvenSkoru ? (
                          <span
                            className={`inline-flex max-h-7 min-w-[42px] items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none ${
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
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                      <td className="p-1.5">
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
                      <td className="p-1.5">
                        <input
                          value={row.borc ?? ""}
                          onChange={(event) =>
                            patchRow(row.id, { borc: event.target.value, alacak: "" })
                          }
                          className={`${cellInputClassName} text-right`}
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          value={row.alacak ?? ""}
                          onChange={(event) =>
                            patchRow(row.id, { alacak: event.target.value, borc: "" })
                          }
                          className={`${cellInputClassName} text-right`}
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          value={row.karsiHesapKodu || ""}
                          onChange={(event) =>
                            patchRow(row.id, { karsiHesapKodu: event.target.value })
                          }
                          className={`${cellInputClassName} font-mono`}
                        />
                      </td>
                      {renderKontrolCell ? (
                        <td className="max-w-[180px] p-1.5">{renderKontrolCell(row)}</td>
                      ) : null}
                      <td className="p-1.5 text-center">
                        {duplicateScore > 0 ? (
                          <PreviewRiskBadge
                            score={duplicateScore}
                            level={duplicateRisk?.level}
                            variant={
                              isCriticalDuplicate
                                ? "critical"
                                : isHighDuplicate
                                  ? "high"
                                  : isMediumDuplicate
                                    ? "medium"
                                    : "default"
                            }
                          />
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                      <td className="p-1.5">
                        <PreviewClampList items={errors} tone="text-red-300" />
                      </td>
                      <td className="p-1.5">
                        <PreviewClampList items={warnings} tone="text-amber-300" />
                      </td>
                      <td className={`p-1.5 ${annveroTableStickyRightTd} ${rowSurfaceClass}`}>
                        <div className="flex items-center justify-center gap-1">
                          {showAdvancedEdit && onSaveAdvancedEdit ? (
                            <button
                              type="button"
                              onClick={() => openAdvancedEdit(row, buildStandardLucaRowEditDraft)}
                              className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition ${
                                editingRowId === row.id
                                  ? "border-indigo-500 bg-indigo-950/60 text-indigo-200"
                                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-indigo-500 hover:text-white"
                              }`}
                            >
                              Detay
                            </button>
                          ) : null}
                          {showCoreTeachForRow?.(row) && onCoreTeachClick ? (
                            <button
                              type="button"
                              onClick={() => onCoreTeachClick(row)}
                              className="rounded-md border border-indigo-600/70 bg-indigo-950/40 px-2 py-1 text-[10px] font-semibold text-indigo-200 transition hover:bg-indigo-950/70"
                            >
                              Öğret
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(row)}
                            className="rounded-md border border-red-700/60 bg-red-950/30 px-2 py-1 text-[10px] font-semibold text-red-300 transition hover:bg-red-950/60"
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
