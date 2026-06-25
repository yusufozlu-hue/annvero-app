export function parseTebEkstre(sheetRows) {
    if (!sheetRows || sheetRows.length === 0) return [];
  
    const rows = sheetRows.slice(1);
  
    return rows
      .filter((row) => row && row.some((x) => String(x || "").trim() !== ""))
      .map((row) => {
        const tarih = row[0] || "";
        const aciklama = row[1] || "";
        const borc = parseMoney(row[2]);
        const alacak = parseMoney(row[3]);
        const bakiye = parseMoney(row[4]);
        const tutar = borc > 0 ? borc : -alacak;
  
        return {
          banka: "TEB",
          tarih,
          dekontNo: "",
          aciklama,
          borc,
          alacak,
          bakiye,
          tutar,
          yon: tutar > 0 ? "GIRIS" : "CIKIS",
          islemTipi: "DIGER",
        };
      });
  }
  
  function parseMoney(value) {
    if (!value) return 0;
  
    return Number(
      String(value)
        .replace(/\./g, "")
        .replace(",", ".")
        .replace(/[^\d.-]/g, "")
    );
  }