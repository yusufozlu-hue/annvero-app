let pendingCountCache = { key: "", at: 0, count: 0 };

export async function fetchPendingTransactionCount(companyId = "", options = {}) {
  const cacheKey = `${companyId || "all"}:pending`;
  const now = Date.now();
  const ttlMs = options.ttlMs ?? 30_000;

  if (
    !options.force &&
    pendingCountCache.key === cacheKey &&
    now - pendingCountCache.at < ttlMs
  ) {
    return pendingCountCache.count;
  }

  const params = new URLSearchParams({ status: "pending" });
  if (companyId) params.set("companyId", companyId);

  const response = await fetch(`/api/transaction-memory?${params}`, {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    return pendingCountCache.key === cacheKey ? pendingCountCache.count : 0;
  }

  const body = await response.json();
  const count = Array.isArray(body.data) ? body.data.length : 0;
  pendingCountCache = { key: cacheKey, at: now, count };
  return count;
}

export function invalidateTransactionMemoryCache() {
  pendingCountCache = { key: "", at: 0, count: 0 };
}

export async function fetchUnrecognizedTransactions(options = {}) {
  const params = new URLSearchParams();

  if (options.companyId) params.set("companyId", options.companyId);
  if (options.status) params.set("status", options.status);

  const query = params.toString();
  const response = await fetch(
    query ? `/api/transaction-memory?${query}` : "/api/transaction-memory",
    { cache: "no-store" }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Tanınmayan işlemler yüklenemedi.");
  }

  const body = await response.json();
  return body.data || [];
}

export async function queueUnrecognizedTransactions(items = []) {
  const response = await fetch("/api/transaction-memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "queue", items }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Tanınmayan işlemler kuyruğa alınamadı.");
  }

  return body;
}

export async function learnUnrecognizedTransaction(id, draft = {}) {
  const response = await fetch("/api/transaction-memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "learn", id, draft }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "İşlem öğrenilemedi.");
  }

  return body;
}

export async function dismissUnrecognizedTransaction(id) {
  const response = await fetch("/api/transaction-memory", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status: "dismissed" }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "İşlem güncellenemedi.");
  }

  return body;
}

export async function updateUnrecognizedTransactionDraft(id, fields = {}) {
  const response = await fetch("/api/transaction-memory", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...fields }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "İşlem güncellenemedi.");
  }

  return body;
}
