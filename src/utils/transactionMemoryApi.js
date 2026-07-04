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
