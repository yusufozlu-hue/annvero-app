/**
 * Hesap planı parse / fingerprint / sürüm kuralları (istemci + test).
 * Ham Excel loglanmaz.
 */

export function normalizeAccountPlanRowInput(row = {}) {
  const accountCode = String(row.accountCode || row.code || "").trim();
  const accountName = String(row.accountName || row.name || "").trim();
  const currency = String(row.currency || "TL").trim() || "TL";
  if (!accountCode || !accountName) return null;
  return {
    accountCode,
    accountName,
    currency,
    isActive: row.isActive !== false,
  };
}

export function parseAccountPlanSheetRows(rows = []) {
  const accounts = [];
  let errorCount = 0;
  for (const row of rows || []) {
    if (!Array.isArray(row)) {
      errorCount += 1;
      continue;
    }
    const codeRaw = String(row[0] || "").trim();
    const nameRaw = String(row[1] || "").trim();
    if (/hesap\s*kod|account\s*code|^kod$/i.test(codeRaw)) {
      continue;
    }
    if (/hesap\s*ad|account\s*name|^ad$|^açıklama$/i.test(nameRaw)) {
      continue;
    }
    const parsed = normalizeAccountPlanRowInput({
      accountCode: codeRaw,
      accountName: nameRaw,
      currency: row[2],
    });
    if (!parsed) {
      const hasAny = row.some((c) => String(c || "").trim());
      if (hasAny) errorCount += 1;
      continue;
    }
    accounts.push(parsed);
  }
  return { accounts, errorCount };
}

export async function fingerprintAccountPlanAccounts(accounts = []) {
  const lines = (accounts || [])
    .map(
      (a) =>
        `${String(a.accountCode || "").trim()}|${String(a.accountName || "").trim()}|${String(a.currency || "TL").trim()}|${a.isActive === false ? "0" : "1"}`
    )
    .sort((a, b) => a.localeCompare(b, "tr"));
  const payload = lines.join("\n");
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Node fallback
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function diffAccountPlanVersions(previous = [], next = []) {
  const prevMap = new Map(
    (previous || []).map((a) => [String(a.accountCode || "").trim(), a])
  );
  const nextCodes = new Set();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of next || []) {
    const code = String(row.accountCode || "").trim();
    if (!code) continue;
    nextCodes.add(code);
    const prev = prevMap.get(code);
    if (!prev) {
      added += 1;
      continue;
    }
    if (
      String(prev.accountName || "") === String(row.accountName || "") &&
      String(prev.currency || "TL") === String(row.currency || "TL") &&
      (prev.isActive !== false) === (row.isActive !== false)
    ) {
      skipped += 1;
    } else {
      updated += 1;
    }
  }
  return {
    addedCount: added,
    updatedCount: updated,
    skippedCount: skipped,
    removedCount: Math.max(0, prevMap.size - [...prevMap.keys()].filter((c) => nextCodes.has(c)).length),
  };
}

export function formatAccountPlanUploadStatus(status = "") {
  switch (String(status || "")) {
    case "active":
      return "Aktif sürüm";
    case "duplicate":
      return "Mükerrer yükleme — yeniden işlenmedi";
    case "failed":
      return "Başarısız";
    case "superseded":
      return "Süpercede";
    case "rolled_back":
      return "Geri alındı";
    case "pending":
      return "Doğrulama";
    default:
      return status || "—";
  }
}

export const EMPTY_ACCOUNT_PLAN_MESSAGE = "Bu firmanın hesap planı tanımlı değil.";

export function paginateAccountPlanRows(rows = [], { page = 1, pageSize = 50, query = "" } = {}) {
  const q = String(query || "")
    .toLocaleLowerCase("tr")
    .trim();
  const filtered = !q
    ? rows || []
    : (rows || []).filter((row) =>
        `${row.accountCode || ""} ${row.accountName || ""}`
          .toLocaleLowerCase("tr")
          .includes(q)
      );
  const size = Math.min(200, Math.max(10, Number(pageSize) || 50));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(pageCount, Math.max(1, Number(page) || 1));
  const start = (safePage - 1) * size;
  const slice = filtered.slice(start, start + size);
  const activeCount = filtered.filter((r) => r.isActive !== false).length;
  return {
    rows: slice,
    total,
    page: safePage,
    pageSize: size,
    pageCount,
    activeCount,
    inactiveCount: total - activeCount,
  };
}
