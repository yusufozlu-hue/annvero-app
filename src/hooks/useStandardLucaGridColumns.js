"use client";

import { useMemo } from "react";
import { DOCUMENT_TYPE_OPTIONS } from "@/src/utils/previewRowEdit";

export function useStandardLucaGridColumns({
  showKaynakColumn = false,
  editingRowId = "",
} = {}) {
  return useMemo(() => {
    const columns = [
      { key: "fisNo", label: "Fiş No", sortable: true },
      { key: "fisTarihi", label: "Tarih", sortable: true },
    ];

    if (showKaynakColumn) {
      columns.push({
        key: "kaynakTipi",
        label: "Kaynak",
        render: (row) => (
          <div>
            <div>{row.kaynakTipi || "—"}</div>
            <div className="text-xs text-slate-500">{row.kaynakAdi || ""}</div>
          </div>
        ),
      });
    }

    columns.push(
      {
        key: "hesapKodu",
        label: "Hesap Kodu",
        editable: true,
        editKey: "hesapKodu",
        editDisplay: (row) => (editingRowId === row.id ? null : row.hesapKodu || "—"),
      },
      {
        key: "fisAciklama",
        label: "Açıklama",
        editable: true,
        editKey: "fisAciklama",
        editDisplay: (row) =>
          editingRowId === row.id ? null : row.detayAciklama || row.fisAciklama || "—",
      },
      {
        key: "belgeTuru",
        label: "Belge Türü",
        editable: true,
        editKey: "belgeTuru",
        editType: "select",
        editOptions: DOCUMENT_TYPE_OPTIONS.map((option) => ({ value: option, label: option })),
      },
      {
        key: "borc",
        label: "Borç",
        render: (row) => Number(row.borc || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 }),
      },
      {
        key: "alacak",
        label: "Alacak",
        render: (row) =>
          Number(row.alacak || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 }),
      }
    );

    return columns;
  }, [showKaynakColumn, editingRowId]);
}
