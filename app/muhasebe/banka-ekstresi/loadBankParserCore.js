/**
 * Bank parser çekirdeğini ihtiyaç anında yükler (ilk sayfa kabuğundan ayrı chunk).
 * İşlev değiştirmez; yalnız import zamanlaması.
 */
let bankParserCorePromise = null;

export function loadBankParserCore() {
  if (!bankParserCorePromise) {
    bankParserCorePromise = import("@/src/utils/bankParserCore");
  }
  return bankParserCorePromise;
}

export function resetBankParserCoreLoaderForTests() {
  bankParserCorePromise = null;
}
