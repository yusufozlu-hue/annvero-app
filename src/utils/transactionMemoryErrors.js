export const TRANSACTION_MEMORY_SCHEMA_MESSAGE =
  "İşlem hafızası henüz hazır değil. Lütfen kısa süre sonra tekrar deneyin veya yöneticinize başvurun.";

export function isTransactionMemorySchemaError(error) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return (
    error?.code === "PGRST205" ||
    error?.code === "PGRST204" ||
    /schema cache/i.test(text) ||
    /could not find the table/i.test(text) ||
    /relation .* does not exist/i.test(text)
  );
}

export function mapTransactionMemoryError(error, fallback = "İşlem hafızası isteği tamamlanamadı.") {
  if (isTransactionMemorySchemaError(error)) {
    return TRANSACTION_MEMORY_SCHEMA_MESSAGE;
  }
  return error?.message || fallback;
}
