"use client";

import { Fragment, useMemo, useState } from "react";
import PreviewVoucherDetailPanel from "./PreviewVoucherDetailPanel";
import { DOCUMENT_TYPE_OPTIONS, buildStandardLucaRowEditDraft } from "@/src/utils/previewRowEdit";
import { validatePreviewForExport } from "@/src/utils/previewExportValidation";
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
  isSavingAdvancedEdit = false,
  showAdvancedEdit = true,
}) {
  const [editingRowId, setEditingRowId] = useState(null);
  const [draftRow, setDraftRow] = useState(null);

  const liveValidation = useMemo(
    () => validatePreviewForExport(rows),
    [rows]
  );

  const validation = exportValidation || liveValidation;

  const rowErrorById = useMemo(() => {
    const map = new Map();
    for (const item of validation.rowErrors || []) {
      if (item.rowId) map.set(item.rowId, item.errors);
    }
    return map;
  }, [validation.rowErrors]);

  const patchRow = (rowId, patch) => {
    onRowsChange(
      rows.map((row) =>
        row.id === rowId
          ? finalizeStandardLucaRow({ ...row, ...patch, manuallyEdited: true })
          : row
      )
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
    11 + (showKaynakColumn ? 1 : 0) + (renderKontrolCell ? 1 : 0);

  return (
    <div className="space-y-4">
      {!validation.ok && exportValidation ? (
        <div className="rounded-xl border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          <p className="font-semibold">Excel oluşturulamadı — lütfen hataları düzeltin:</p>
          {validation.globalErrors?.length ? (
            <ul className="mt-2 list-inside list-disc">
              {validation.globalErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
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
              <th className="p-3 text-left">Belge Türü</th>
              <th className="p-3 text-right">Borç</th>
              <th className="p-3 text-right">Alacak</th>
              <th className="p-3 text-left">Karşı Hesap</th>
              {renderKontrolCell ? <th className="p-3 text-left">Kontrol</th> : null}
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

                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`border-t border-gray-800 ${
                        errors.length ? "bg-red-950/20" : ""
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
                            patchRow(row.id, { hesapKodu: event.target.value })
                          }
                          className={`${cellInputClassName} font-mono`}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          value={row.hesapAdi || ""}
                          onChange={(event) =>
                            patchRow(row.id, { hesapAdi: event.target.value })
                          }
                          className={`${cellInputClassName} min-w-[140px]`}
                        />
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
                      <td className="p-3 align-top">
                        {errors.length ? (
                          <ul className="space-y-1 text-[11px] text-red-300">
                            {errors.map((error) => (
                              <li key={error}>• {error}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs text-emerald-400">—</span>
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
