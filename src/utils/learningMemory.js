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

export async function fetchAllLearningMemory(options = {}) {
  const params = new URLSearchParams();

  if (options.includeInactive) {
    params.set("includeInactive", "1");
  }

  const query = params.toString();
  const url = query ? `/api/learning-memory?${query}` : "/api/learning-memory";

  try {
    const response = await fetch(url);

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

export async function createLearningMemoryRecord(record) {
  try {
    const response = await fetch("/api/learning-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record }),
    });

    if (!response.ok) {
      console.error("learning_memory create failed", await response.text());
      return null;
    }

    const payload = await response.json();
    return payload.data || null;
  } catch (error) {
    console.error("learning_memory create failed", error);
    return null;
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
