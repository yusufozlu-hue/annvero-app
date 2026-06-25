"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { saveAs } from "file-saver";

import { tebParser } from "@/src/parsers/tebParser";
import { garantiParser } from "@/src/parsers/garantiParser";
import { vakifParser } from "@/src/parsers/vakifParser";
import { ziraatParser } from "@/src/parsers/ziraatParser";
import { kuveytParser } from "@/src/parsers/kuveytParser";

import {
  lucaConverter,
  splitByFis,
  getFisRange,
} from "@/src/converters/lucaConverter";

type Banka = "TEB" | "GARANTI" | "VAKIF" | "ZIRAAT" | "KUVEYT";

export default function BankaLucaPage() {
  const [banka, setBanka] = useState<Banka>("TEB");
  const [rows, setRows] = useState<any[]>([]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      const data = new Uint8Array(event.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      const jsonData = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
      }) as any[];

      let parsed: any[] = [];

      if (banka === "TEB") parsed = tebParser(jsonData);
      if (banka === "GARANTI") parsed = garantiParser(jsonData);
      if (banka === "VAKIF") parsed = vakifParser(jsonData);
      if (banka === "ZIRAAT") parsed = ziraatParser(jsonData);
      if (banka === "KUVEYT") parsed = kuveytParser(jsonData);

      const lucaRows = lucaConverter(parsed, banka);
      setRows(lucaRows);
    };

    reader.readAsArrayBuffer(file);
  }

  async function exportToExcel() {
    if (rows.length === 0) {
      alert("Önce dosya yüklemelisin.");
      return;
    }

    const zip = new JSZip();
    const grouped = splitByFis(rows, 50);

    for (const group of grouped) {
      const worksheet = XLSX.utils.json_to_sheet(group);
      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(workbook, worksheet, "LUCA");

      const excelBuffer = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "array",
      });

      const range = getFisRange(group);
      const firstDate = group[0]?.["Fiş Tarihi"] || "TARIH";

      const fileName = `${banka}_${firstDate}_FIS_${range.start}-${range.end}.xlsx`;

      zip.file(fileName, excelBuffer);
    }

    const content = await zip.generateAsync({
      type: "blob",
    });

    saveAs(content, `${banka}_LUCA_AKTARIM.zip`);
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">
        Banka Ekstresi → Luca Aktarım
      </h1>

      <div className="rounded-2xl border border-gray-700 bg-gray-900 p-6 max-w-7xl">
        <select
          value={banka}
          onChange={(e) => {
            setBanka(e.target.value as Banka);
            setRows([]);
          }}
          className="mb-6 block w-full rounded-lg border border-gray-700 bg-gray-800 p-3"
        >
          <option value="TEB">TEB</option>
          <option value="GARANTI">Garanti Bankası</option>
          <option value="VAKIF">VakıfBank</option>
          <option value="ZIRAAT">Ziraat Bankası</option>
          <option value="KUVEYT">Kuveyt Türk</option>
        </select>

        <input
          type="file"
          onChange={handleFileUpload}
          className="mb-6 block w-full rounded-lg border border-gray-700 bg-gray-800 p-3"
        />

        <button
          onClick={exportToExcel}
          className="mb-6 rounded-lg bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-700"
        >
          Luca Excel Dosyalarını ZIP Olarak İndir
        </button>

        <div className="overflow-auto">
          <table className="w-full border border-gray-700 text-sm">
            <thead>
              <tr className="bg-gray-800">
                {rows[0] &&
                  Object.keys(rows[0]).map((key) => (
                    <th
                      key={key}
                      className="border border-gray-700 p-2 text-left"
                    >
                      {key}
                    </th>
                  ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-gray-700">
                  {Object.values(row).map((value: any, j) => (
                    <td
                      key={j}
                      className="border border-gray-700 p-2"
                    >
                      {String(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}