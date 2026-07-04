export const LEARNING_MEMORY_SCHEMA_MESSAGE =
  "Öğrenme kaydı oluşturulamadı. Veritabanı şeması güncellenmeli.";

export const SAFE_LEARNING_MEMORY_COLUMNS = [
  "raw_description",
  "clean_description",
  "keyword",
  "account_code",
  "account_name",
  "document_type",
  "cari_name",
  "transaction_type",
  "user_correction",
  "learned_at",
  "bank_name",
  "amount",
  "status",
];

function firstValue(source = {}, keys = []) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return undefined;
}

function assignIfPresent(payload, field, value) {
  if (value !== undefined && value !== null) {
    payload[field] = value;
  }
}

export function isLearningMemorySchemaError(error) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return (
    error?.code === "PGRST204" ||
    /schema cache/i.test(text) ||
    /could not find .* column/i.test(text) ||
    /column .* does not exist/i.test(text)
  );
}

export function buildSafeLearningMemoryPayload(input = {}) {
  const payload = {};

  // company_id is the required ownership key for existing learning_memory rows.
  assignIfPresent(payload, "company_id", firstValue(input, ["company_id", "companyId"]));

  assignIfPresent(
    payload,
    "raw_description",
    firstValue(input, ["raw_description", "rawDescription"])
  );
  assignIfPresent(
    payload,
    "clean_description",
    firstValue(input, ["clean_description", "cleanDescription", "description_format"])
  );
  assignIfPresent(payload, "keyword", firstValue(input, ["keyword"]));
  assignIfPresent(
    payload,
    "account_code",
    firstValue(input, ["account_code", "accountCode"])
  );
  assignIfPresent(
    payload,
    "account_name",
    firstValue(input, ["account_name", "accountName"])
  );
  assignIfPresent(
    payload,
    "document_type",
    firstValue(input, ["document_type", "documentType"])
  );
  assignIfPresent(payload, "cari_name", firstValue(input, ["cari_name", "cariName"]));
  assignIfPresent(
    payload,
    "transaction_type",
    firstValue(input, ["transaction_type", "transactionType"])
  );
  assignIfPresent(
    payload,
    "user_correction",
    firstValue(input, ["user_correction", "userCorrection"])
  );
  assignIfPresent(payload, "learned_at", firstValue(input, ["learned_at", "learnedAt"]));
  assignIfPresent(payload, "bank_name", firstValue(input, ["bank_name", "bankName"]));
  assignIfPresent(payload, "amount", firstValue(input, ["amount"]));
  assignIfPresent(payload, "status", firstValue(input, ["status"]));

  return payload;
}
