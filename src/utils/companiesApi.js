function formatApiError(body = {}, fallback = "İstek başarısız.") {
  const parts = [body.error, body.details, body.hint].filter(Boolean);
  return parts.join(" — ") || fallback;
}

export async function saveCompanyRecord(payload) {
  const response = await fetch("/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(formatApiError(body, "Firma kaydedilemedi."));
  }

  return body.data;
}

export async function deleteCompanyRecord(companyId) {
  const response = await fetch(
    `/api/companies?companyId=${encodeURIComponent(companyId)}`,
    { method: "DELETE" }
  );

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(formatApiError(body, "Firma silinemedi."));
  }

  return body;
}
