/**
 * Banka parser — tek kopya bellek deposu (React state dışında).
 * Full dataset yalnızca burada tutulur; UI yalnızca sayfa dilimini alır.
 */

export const BANK_PREVIEW_PAGE_SIZE = 100;
export const WORKER_ROWS_CHUNK_SIZE = 200;

export function createEmptyBankParserStore() {
  return {
    normalizedRows: [],
    movements: [],
    lucaRows: [],
    unrecognizedItems: [],
    declarationSummary: null,
    coreSummary: null,
    rawCount: 0,
    movementById: null,
  };
}

export function clearBankParserStore(store) {
  store.normalizedRows = [];
  store.movements = [];
  store.lucaRows = [];
  store.unrecognizedItems = [];
  store.declarationSummary = null;
  store.coreSummary = null;
  store.rawCount = 0;
  store.movementById = null;
}

export function setStoreDataset(store, { normalizedRows, movements, lucaRows, rawCount }) {
  store.normalizedRows = Array.isArray(normalizedRows) ? normalizedRows : [];
  store.movements = Array.isArray(movements) ? movements : [];
  store.lucaRows = Array.isArray(lucaRows) ? lucaRows : [];
  store.rawCount = Number(rawCount) || store.normalizedRows.length || 0;
  store.movementById = null;
}

export function getMovementById(store, id) {
  if (!id) return null;
  if (!store.movementById) {
    const map = new Map();
    for (const movement of store.movements) {
      if (movement?.id) map.set(movement.id, movement);
    }
    store.movementById = map;
  }
  return store.movementById.get(id) || null;
}

export function replaceLucaRowInStore(store, rowId, nextRow) {
  const index = store.lucaRows.findIndex((row) => row?.id === rowId);
  if (index < 0) return false;
  store.lucaRows[index] = nextRow;
  return true;
}

export function replaceMovementInStore(store, movementId, nextMovement) {
  const index = store.movements.findIndex((row) => row?.id === movementId);
  if (index < 0) return false;
  store.movements[index] = nextMovement;
  store.movementById = null;
  return true;
}

/**
 * Özet metrikleri full dizi üzerinde tek geçişte hesaplar (ikinci kopya üretmez).
 */
export function computeLucaPreviewSummaryFromStore(lucaRows = []) {
  let recognized = 0;
  let unknown = 0;
  let risky = 0;
  const total = lucaRows.length;

  for (let i = 0; i < total; i += 1) {
    const row = lucaRows[i];
    const warning = String(row?.kontrolNotu || row?.uyari || row?.warning || "");
    const hesap = String(row?.hesapKodu || "").trim();
    if (!hesap || warning.includes("Hesap eşleşmesi") || warning.includes("Kural bulunamadı")) {
      unknown += 1;
    } else if (warning.includes("risk") || row?.riskDurumu) {
      risky += 1;
    } else {
      recognized += 1;
    }
  }

  return {
    totalMovements: Math.ceil(total / 2),
    lucaRows: total,
    recognized,
    unknown,
    risky,
    suggested: 0,
  };
}
