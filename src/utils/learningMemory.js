export async function fetchLearningMemoryForCompany(companyId, options = {}) {
  if (!companyId) return [];

  const params = new URLSearchParams({
    companyId,
  });

  if (options.includeInactive) {
    params.set("includeInactive", "1");
  }

  try {
    const response = await fetch(`/api/learning-memory?${params.toString()}`);

    if (!response.ok) {
      console.error("learning_memory fetch failed", await response.text());
      return [];
    }

    const payload = await response.json();
    return payload.data || [];
  } catch (error) {
    console.error("learning_memory fetch failed", error);
    return [];
  }
}

function normalizeLearningMemoryList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.records)) return payload.records;
  return [];
}

async function readLearningMemoryError(response) {
  try {
    const payload = await response.json();
    return payload?.error || response.statusText || "Kayıtlar yüklenemedi.";
  } catch {
    const text = await response.text().catch(() => "");
    return text || response.statusText || "Kayıtlar yüklenemedi.";
  }
}

export async function fetchAllLearningMemory(options = {}) {
  const params = new URLSearchParams();

  if (options.includeInactive) {
    params.set("includeInactive", "1");
  }

  const query = params.toString();
  const url = query ? `/api/learning-memory?${query}` : "/api/learning-memory";

  try {
    const response = await fetch(url, { cache: "no-store", credentials: "include" });

    if (!response.ok) {
      const error = await readLearningMemoryError(response);
      console.error("learning_memory fetch failed", error);
      return { data: [], error };
    }

    const payload = await response.json();
    return { data: normalizeLearningMemoryList(payload), error: null };
  } catch (error) {
    console.error("learning_memory fetch failed", error);
    return {
      data: [],
      error: error?.message || "Kayıtlar yüklenemedi.",
    };
  }
}

export async function createLearningMemoryRecord(record) {
  const result = await createLearningMemoryRecordDetailed(record);
  return result.data;
}

export async function createLearningMemoryRecordDetailed(record) {
  try {
    const response = await fetch("/api/learning-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ record }),
    });

    if (!response.ok) {
      const error = await readLearningMemoryError(response);
      console.error("learning_memory create failed", error);
      return { data: null, error };
    }

    const payload = await response.json();
    return { data: payload.data || null, error: null };
  } catch (error) {
    console.error("learning_memory create failed", error);
    return {
      data: null,
      error: error?.message || "Kayıt oluşturulamadı.",
    };
  }
}

export async function updateLearningMemoryRecord(id, fields) {
  if (!id) return false;

  try {
    const response = await fetch("/api/learning-memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record: { id, ...fields } }),
    });

    if (!response.ok) {
      console.error("learning_memory record update failed", await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error("learning_memory record update failed", error);
    return false;
  }
}

export async function deleteLearningMemoryRecord(id) {
  if (!id) return false;

  try {
    const response = await fetch(
      `/api/learning-memory?id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      console.error("learning_memory delete failed", await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error("learning_memory delete failed", error);
    return false;
  }
}

export async function recordLearningMemoryUsage(rows = []) {
  const counts = {};

  for (const row of rows) {
    if (!row?.matchedMemoryId) continue;
    counts[row.matchedMemoryId] = (counts[row.matchedMemoryId] || 0) + 1;
  }

  const updates = Object.entries(counts).map(([id, increment]) => ({
    id,
    increment,
  }));

  if (updates.length === 0) return;

  try {
    const response = await fetch("/api/learning-memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });

    if (!response.ok) {
      console.error("learning_memory usage update failed", await response.text());
    }
  } catch (error) {
    console.error("learning_memory usage update failed", error);
  }
}
