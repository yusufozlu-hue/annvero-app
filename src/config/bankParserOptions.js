const PARSER_BANK_DEFINITIONS = [
  { id: "GARANTI", label: "Garanti Bankası" },
  { id: "VAKIFBANK", label: "Vakıfbank" },
  { id: "TEB", label: "TEB" },
  { id: "KUVEYT", label: "Kuveyt Türk" },
  { id: "ZIRAAT", label: "Ziraat Bankası" },
];

const MUTABAKAT_BANK_DEFINITIONS = [
  { id: "GARANTI", label: "Garanti" },
  { id: "VAKIFBANK", label: "Vakıfbank" },
  { id: "TEB", label: "TEB" },
  { id: "KUVEYT", label: "Kuveyt Türk" },
  { id: "ZIRAAT", label: "Ziraat" },
  { id: "DIGER", label: "Diğer" },
];

export function sortBankOptions(options) {
  return [...options].sort((a, b) =>
    a.label.localeCompare(b.label, "tr", { sensitivity: "base" })
  );
}

export const BANK_PARSER_OPTIONS = sortBankOptions(PARSER_BANK_DEFINITIONS);

export const BANK_MUTABAKAT_OPTIONS = sortBankOptions(MUTABAKAT_BANK_DEFINITIONS);

export function getDefaultBankParserId() {
  return BANK_PARSER_OPTIONS[0]?.id || "GARANTI";
}
