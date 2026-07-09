export async function saveKnowledgeTeachRequest({
  teach,
  movement,
  movementContext = {},
}) {
  const response = await fetch("/api/knowledge/builder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      teach,
      movement: {
        description: movement?.description,
        direction: movement?.direction,
        date: movement?.date,
        amount: movement?.amount,
        raw_row: movement?.rawRow || movement?.raw_row || {},
      },
      movement_context: movementContext,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Knowledge Builder ${response.status}`);
  }

  return payload?.data || {};
}
