import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { MEMORY_MATCH_LABEL } from "@/src/utils/previewRowEdit";

export const KONTROL_SEVIYE = {
  HATA: "Hata",
  UYARI: "Uyarı",
  BILGI: "Bilgi",
};

export const KONTROL_TIP = {
  EKSIK_HESAP: "Eksik hesap kodu",
  EKSIK_ACIKLAMA: "Eksik açıklama",
  DENGESIZ_FIS: "Dengesiz fiş",
  FIS_BORC_ALACAK_ESIT_DEGIL: "Fiş borç/alacak eşit değil",
  MUKERRER_EVRAK: "Mükerrer evrak no",
  MUKERRER_HAREKET: "Tekrarlayan hareket",
  EKSIK_BELGE_TURU: "Belge türü eksik",
  HATALI_TARIH: "Tarih formatı hatalı",
  BORC_ALACAK_IKISI_DOLU: "Borç/alacak aynı anda dolu",
  BORC_ALACAK_IKISI_BOS: "Borç/alacak ikisi de boş",
  OGRENEN_HAFIZA: "Öğrenen hafıza",
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

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getRowDescription(row) {
  return String(row.detayAciklama || row.fisAciklama || row.aciklama || "").trim();
}

function isValidLucaDateString(value) {
  const text = String(value || "").trim();
  if (!text) return false;

  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(text)) {
    return false;
  }

  return Boolean(parseDateTR(text));
}

function createIssue(type, seviye, message) {
  return { type, seviye, message };
}

function resolveRiskSeviyesi(issues = []) {
  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.HATA)) {
    return "Yüksek";
  }

  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.UYARI)) {
    return "Orta";
  }

  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.BILGI)) {
    return "Düşük";
  }

  return "Temiz";
}

function resolvePrimarySeviye(issues = []) {
  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.HATA)) {
    return KONTROL_SEVIYE.HATA;
  }

  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.UYARI)) {
    return KONTROL_SEVIYE.UYARI;
  }

  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.BILGI)) {
    return KONTROL_SEVIYE.BILGI;
  }

  return "Temiz";
}

function buildKontrolNotu(issues = [], existingNote = "") {
  const messages = issues.map((issue) => issue.message).filter(Boolean);
  const existing = String(existingNote || "").trim();

  if (existing && !messages.includes(existing)) {
    messages.unshift(existing);
  }

  return messages.join(" · ");
}

function getRowAmount(row) {
  const borc = parseMoneyTR(row.borc);
  const alacak = parseMoneyTR(row.alacak);
  return borc > 0 ? borc : alacak;
}

export function analyzeStandardLucaRows(rows = []) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const rowIssues = sourceRows.map(() => []);
  const duplicateMovementKeys = new Map();
  const duplicateEvrakNos = new Map();
  const fisTotals = new Map();

  sourceRows.forEach((row, index) => {
    const hesapKodu = String(row.hesapKodu || "").trim();
    const aciklama = getRowDescription(row);
    const fisTarihi = String(row.fisTarihi || "").trim();
    const belgeTuru = String(row.belgeTuru || "").trim();
    const evrakNo = String(row.evrakNo || "").trim();
    const borc = parseMoneyTR(row.borc);
    const alacak = parseMoneyTR(row.alacak);
    const existingNote = String(row.kontrolNotu || "").trim();

    if (!hesapKodu) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.EKSIK_HESAP,
          KONTROL_SEVIYE.HATA,
          "Hesap kodu alanı boş."
        )
      );
    }

    if (!aciklama) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.EKSIK_ACIKLAMA,
          KONTROL_SEVIYE.HATA,
          "Detay açıklama ve fiş açıklama alanları boş."
        )
      );
    }

    if (!belgeTuru) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.EKSIK_BELGE_TURU,
          KONTROL_SEVIYE.HATA,
          "Belge türü alanı boş."
        )
      );
    }

    if (!fisTarihi) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.HATALI_TARIH,
          KONTROL_SEVIYE.HATA,
          "Fiş tarihi alanı boş."
        )
      );
    } else if (!isValidLucaDateString(fisTarihi)) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.HATALI_TARIH,
          KONTROL_SEVIYE.HATA,
          `Fiş tarihi geçersiz format: "${fisTarihi}". Beklenen: GG.AA.YYYY`
        )
      );
    }

    if (borc > 0 && alacak > 0) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.BORC_ALACAK_IKISI_DOLU,
          KONTROL_SEVIYE.HATA,
          "Aynı satırda hem borç hem alacak dolu."
        )
      );
    }

    if (borc <= 0 && alacak <= 0) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.BORC_ALACAK_IKISI_BOS,
          KONTROL_SEVIYE.HATA,
          "Borç ve alacak tutarları boş veya sıfır."
        )
      );
    }

    const movementKey = [
      compactText(fisTarihi),
      getRowAmount(row).toFixed(2),
      compactText(aciklama),
    ].join("|");

    if (movementKey.replace(/\|/g, "").length > 0) {
      const previousIndex = duplicateMovementKeys.get(movementKey);
      const previousRow =
        previousIndex !== undefined ? sourceRows[previousIndex] : null;
      const sameFis =
        previousRow &&
        String(previousRow.fisNo ?? "").trim() !== "" &&
        String(previousRow.fisNo ?? "").trim() === String(row.fisNo ?? "").trim();
      const sameMovement =
        previousRow &&
        String(previousRow.sourceMovementId || previousRow._movementId || "").trim() &&
        String(previousRow.sourceMovementId || previousRow._movementId || "").trim() ===
          String(row.sourceMovementId || row._movementId || "").trim();

      // Aynı fişin borç/alacak satırları veya aynı hareketin kalemleri mükerrer değil
      if (previousIndex !== undefined && !sameFis && !sameMovement) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.MUKERRER_HAREKET,
            KONTROL_SEVIYE.UYARI,
            `Aynı tarih, tutar ve açıklama ${previousIndex + 1}. satır ile tekrar ediyor (Fiş ${previousRow?.fisNo || "—"}).`
          )
        );
      } else if (previousIndex === undefined) {
        duplicateMovementKeys.set(movementKey, index);
      }
    }

    if (evrakNo) {
      const evrakKey = compactText(evrakNo);
      const previousIndex = duplicateEvrakNos.get(evrakKey);

      if (previousIndex !== undefined) {
        const previousRow = sourceRows[previousIndex];
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.MUKERRER_EVRAK,
            KONTROL_SEVIYE.UYARI,
            `Evrak no "${evrakNo}" ${previousIndex + 1}. satırda da kullanılmış (Fiş ${previousRow?.fisNo || "—"}).`
          )
        );
      } else {
        duplicateEvrakNos.set(evrakKey, index);
      }
    }

    const fisKey = String(row.fisNo ?? "").trim() || `ROW-${index + 1}`;

    if (!fisTotals.has(fisKey)) {
      fisTotals.set(fisKey, {
        fisNo: row.fisNo ?? "—",
        borc: 0,
        alacak: 0,
        rowIndexes: [],
      });
    }

    const fisTotal = fisTotals.get(fisKey);
    fisTotal.borc += borc;
    fisTotal.alacak += alacak;
    fisTotal.rowIndexes.push(index);

    if (row.hafizaEslesme) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.OGRENEN_HAFIZA,
          KONTROL_SEVIYE.BILGI,
          MEMORY_MATCH_LABEL
        )
      );
    } else if (
      existingNote &&
      !rowIssues[index].some((issue) => issue.seviye === KONTROL_SEVIYE.HATA)
    ) {
      rowIssues[index].push(
        createIssue(KONTROL_TIP.OGRENEN_HAFIZA, KONTROL_SEVIYE.BILGI, existingNote)
      );
    }
  });

  let unbalancedFisCount = 0;

  fisTotals.forEach((fisTotal) => {
    const diff = Math.abs(fisTotal.borc - fisTotal.alacak);

    if (diff <= 0.01) return;

    unbalancedFisCount += 1;

    const message = `Fiş ${fisTotal.fisNo}: borç ${formatMoney(fisTotal.borc)} / alacak ${formatMoney(fisTotal.alacak)} — fark ${formatMoney(diff)}.`;

    fisTotal.rowIndexes.forEach((rowIndex) => {
      rowIssues[rowIndex].push(
        createIssue(KONTROL_TIP.DENGESIZ_FIS, KONTROL_SEVIYE.HATA, message)
      );
      rowIssues[rowIndex].push(
        createIssue(
          KONTROL_TIP.FIS_BORC_ALACAK_ESIT_DEGIL,
          KONTROL_SEVIYE.HATA,
          "Fiş içinde borç ve alacak toplamları eşit değil."
        )
      );
    });
  });

  const enrichedRows = sourceRows.map((row, index) => {
    const issues = rowIssues[index];
    const riskSeviyesi = resolveRiskSeviyesi(issues);
    const seviye = resolvePrimarySeviye(issues);

    return {
      ...row,
      _kontrol: {
        rowIndex: index + 1,
        issues,
        riskSeviyesi,
        seviye,
        kontrolNotu: buildKontrolNotu(issues, row.kontrolNotu),
        issueTypes: issues.map((issue) => issue.type),
      },
    };
  });

  const flatIssues = enrichedRows.flatMap((row) =>
    row._kontrol.issues.map((issue) => ({
      ...issue,
      rowIndex: row._kontrol.rowIndex,
      rowId: row.id || `row-${row._kontrol.rowIndex}`,
      fisNo: row.fisNo ?? "—",
      fisTarihi: row.fisTarihi || "—",
      hesapKodu: row.hesapKodu || "—",
      aciklama: getRowDescription(row) || "—",
      tutar: formatMoney(getRowAmount(row)),
    }))
  );

  const hataRowIndexes = new Set(
    enrichedRows
      .filter((row) => row._kontrol.seviye === KONTROL_SEVIYE.HATA)
      .map((row) => row._kontrol.rowIndex)
  );

  return {
    rows: enrichedRows,
    issues: flatIssues,
    summary: {
      totalRows: enrichedRows.length,
      totalFis: fisTotals.size,
      hataRowCount: hataRowIndexes.size,
      hataIssueCount: flatIssues.filter((issue) => issue.seviye === KONTROL_SEVIYE.HATA)
        .length,
      uyariIssueCount: flatIssues.filter((issue) => issue.seviye === KONTROL_SEVIYE.UYARI)
        .length,
      bilgiIssueCount: flatIssues.filter((issue) => issue.seviye === KONTROL_SEVIYE.BILGI)
        .length,
      temizRowCount: enrichedRows.filter((row) => row._kontrol.seviye === "Temiz").length,
      unbalancedFisCount,
      balanceStatus:
        unbalancedFisCount === 0
          ? "Dengeli"
          : `${unbalancedFisCount} fiş dengesiz`,
      isBalanced: unbalancedFisCount === 0,
    },
  };
}

export function filterKontrolRows(rows = [], filter = "all") {
  if (filter === "all") return rows;

  if (filter === "temiz") {
    return rows.filter((row) => row._kontrol?.seviye === "Temiz");
  }

  const wanted =
    filter === "hata"
      ? KONTROL_SEVIYE.HATA
      : filter === "uyari"
        ? KONTROL_SEVIYE.UYARI
        : filter === "bilgi"
          ? KONTROL_SEVIYE.BILGI
          : "";

  return rows.filter((row) => row._kontrol?.seviye === wanted);
}

export function buildFisKontrolExcelRows(analysis) {
  return (analysis?.rows || []).map((row) => ({
    "Satır No": row._kontrol?.rowIndex || "",
    "Fiş No": row.fisNo ?? "",
    "Fiş Tarihi": formatDateTR(row.fisTarihi),
    "Kaynak Tipi": row.kaynakTipi || "",
    "Kaynak Adı": row.kaynakAdi || "",
    "Hesap Kodu": row.hesapKodu || "",
    "Fiş Açıklama": row.fisAciklama || "",
    "Detay Açıklama": row.detayAciklama || row.aciklama || "",
    "Belge Türü": row.belgeTuru || "",
    "Evrak No": row.evrakNo || "",
    Borç: row.borc ?? "",
    Alacak: row.alacak ?? "",
    "Risk Seviyesi": row._kontrol?.riskSeviyesi || "",
    "Kontrol Seviyesi": row._kontrol?.seviye || "",
    "Kontrol Notu": row._kontrol?.kontrolNotu || "",
    "Kontrol Tipleri": (row._kontrol?.issueTypes || []).join(", "),
  }));
}

export function buildFisKontrolIssueExcelRows(analysis) {
  return (analysis?.issues || []).map((issue) => ({
    "Satır No": issue.rowIndex,
    "Fiş No": issue.fisNo,
    "Fiş Tarihi": issue.fisTarihi,
    "Hesap Kodu": issue.hesapKodu,
    Açıklama: issue.aciklama,
    Tutar: issue.tutar,
    "Kontrol Tipi": issue.type,
    Seviye: issue.seviye,
    Mesaj: issue.message,
  }));
}
