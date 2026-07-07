/**
 * Chunked Excel read helpers — batched processing to reduce UI blocking.
 */

export function chunkArray(items = [], chunkSize = 500) {
  const size = Math.max(1, chunkSize);
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function processInChunks(items = [], chunkSize = 500, processor, onProgress) {
  const chunks = chunkArray(items, chunkSize);
  const results = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkResult = await processor(chunk, index, chunks.length);
    results.push(chunkResult);
    onProgress?.({
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      processedRows: Math.min((index + 1) * chunkSize, items.length),
      totalRows: items.length,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return results;
}

export function batchedSetState(setter, patches = [], batchSize = 50) {
  const batches = chunkArray(patches, batchSize);
  batches.forEach((batch, index) => {
    setTimeout(() => {
      setter((prev) => {
        if (Array.isArray(prev)) return [...prev, ...batch];
        return { ...prev, ...Object.assign({}, ...batch) };
      });
    }, index * 0);
  });
}

export function estimateExcelRowCount(sheetRows = []) {
  return Array.isArray(sheetRows) ? sheetRows.length : 0;
}
