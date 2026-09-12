import {
  safeConsoleError,
  safeErrorMessage,
} from "@/src/lib/security/redact";

export async function fetchLearningMemoryForCompany(companyId, options = {}) {
  const result = await fetchLearningMemoryForCompanyDetailed(companyId, options);
  return result.data || [];
}

export async function fetchLearningMemoryForCompanyDetailed(companyId, options = {}) {
  if (!companyId) {
    return { data: [], error: "Firma seçilmedi." };
  }

  const params = new URLSearchParams({
    companyId,
  });

  if (options.includeInactive) {
    params.set("includeInactive", "1");
  }

  try {
    const response = await fetch(`/api/learning-memory?${params.toString()}`, {
      cache: "no-store",
      credentials: "include",
    });

    if (!response.ok) {
      const error = await readLearningMemoryError(response);
      safeConsoleError("learning_memory fetch failed", null, {
        code: "LEARNING_MEMORY_FETCH_FAILED",
      });
      return { data: [], error };
    }

    const payload = await response.json();
    return { data: normalizeLearningMemoryList(payload), error: null };
  } catch (error) {
    safeConsoleError("learning_memory fetch failed", error, {
      code: "LEARNING_MEMORY_FETCH_FAILED",
    });
    return {
      data: [],
      error: safeErrorMessage(error, "Kayıtlar yüklenemedi."),
    };
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
    if (payload?.code === "LEARNING_MEMORY_SCHEMA") {
      return payload?.error || "Öğrenen hafıza şeması güncel değil.";
    }
    return safeErrorMessage(
      { message: payload?.error || response.statusText },
      "Kayıtlar yüklenemedi."
    );
  } catch {
    return "Kayıtlar yüklenemedi.";
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
      safeConsoleError("learning_memory fetch failed", null, {
        code: "LEARNING_MEMORY_FETCH_FAILED",
      });
      return { data: [], error };
    }

    const payload = await response.json();
    return { data: normalizeLearningMemoryList(payload), error: null };
  } catch (error) {
    safeConsoleError("learning_memory fetch failed", error, {
      code: "LEARNING_MEMORY_FETCH_FAILED",
    });
    return {
      data: [],
      error: safeErrorMessage(error, "Kayıtlar yüklenemedi."),
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
      safeConsoleError("learning_memory create failed", null, {
        code: "LEARNING_MEMORY_CREATE_FAILED",
      });
      return { data: null, error };
    }

    const payload = await response.json();
    return { data: payload.data || null, error: null };
  } catch (error) {
    safeConsoleError("learning_memory create failed", error, {
      code: "LEARNING_MEMORY_CREATE_FAILED",
    });
    return {
      data: null,
      error: safeErrorMessage(error, "Kayıt oluşturulamadı."),
    };
  }
}

export async function updateLearningMemoryRecord(id, fields) {
  const result = await updateLearningMemoryRecordDetailed(id, fields);
  return Boolean(result.ok);
}

export async function updateLearningMemoryRecordDetailed(id, fields) {
  if (!id) return { ok: false, error: "Kayıt ID gerekli." };

  try {
    const response = await fetch("/api/learning-memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ record: { id, ...fields } }),
    });

    if (!response.ok) {
      const error = await readLearningMemoryError(response);
      safeConsoleError("learning_memory record update failed", null, {
        code: "LEARNING_MEMORY_UPDATE_FAILED",
      });
      return { ok: false, error };
    }

    const payload = await response.json().catch(() => ({}));
    return { ok: true, data: payload?.data || null, error: null };
  } catch (error) {
    safeConsoleError("learning_memory record update failed", error, {
      code: "LEARNING_MEMORY_UPDATE_FAILED",
    });
    return {
      ok: false,
      error: safeErrorMessage(error, "Kayıt güncellenemedi."),
    };
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
      safeConsoleError("learning_memory delete failed", null, {
        code: "LEARNING_MEMORY_DELETE_FAILED",
      });
      return false;
    }

    return true;
  } catch (error) {
    safeConsoleError("learning_memory delete failed", error, {
      code: "LEARNING_MEMORY_DELETE_FAILED",
    });
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
      safeConsoleError("learning_memory usage update failed", null, {
        code: "LEARNING_MEMORY_USAGE_FAILED",
      });
    }
  } catch (error) {
    safeConsoleError("learning_memory usage update failed", error, {
      code: "LEARNING_MEMORY_USAGE_FAILED",
    });
  }
}
