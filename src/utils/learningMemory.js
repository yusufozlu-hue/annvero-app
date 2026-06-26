export async function fetchLearningMemoryForCompany(companyId) {
  if (!companyId) return [];

  try {
    const response = await fetch(
      `/api/learning-memory?companyId=${encodeURIComponent(companyId)}`
    );

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
