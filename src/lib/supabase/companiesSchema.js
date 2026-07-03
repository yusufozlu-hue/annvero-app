export const COMPANIES_TABLE = "companies";

export function isCompaniesSchemaCacheError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    error?.code === "PGRST205"
  );
}

export function getCompaniesSchemaErrorMessage() {
  return "public.companies tablosu Supabase şema önbelleğinde bulunamadı. 007_companies_table.sql migration dosyasını Supabase SQL Editor'da çalıştırın.";
}
