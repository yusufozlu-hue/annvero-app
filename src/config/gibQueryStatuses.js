export const GIB_QUERY_STATUS = {
  MISSING_CREDENTIALS: "GİB bilgisi eksik",
  AWAITING_VERIFICATION: "Doğrulama kodu bekleniyor",
  QUERYING: "Sorgulanıyor",
  NO_NOTIFICATION: "Tebligat yok",
  NEW_NOTIFICATION: "Yeni tebligat var",
  LOGIN_ERROR: "Giriş hatası",
  SYSTEM_ERROR: "Sistem hatası",
};

export const GIB_QUERY_STATUS_CLASS = {
  [GIB_QUERY_STATUS.MISSING_CREDENTIALS]: "bg-gray-800 text-gray-300",
  [GIB_QUERY_STATUS.AWAITING_VERIFICATION]: "bg-amber-900/60 text-amber-100",
  [GIB_QUERY_STATUS.QUERYING]: "bg-sky-900/60 text-sky-100",
  [GIB_QUERY_STATUS.NO_NOTIFICATION]: "bg-emerald-900/60 text-emerald-100",
  [GIB_QUERY_STATUS.NEW_NOTIFICATION]: "bg-violet-900/60 text-violet-100",
  [GIB_QUERY_STATUS.LOGIN_ERROR]: "bg-red-900/60 text-red-100",
  [GIB_QUERY_STATUS.SYSTEM_ERROR]: "bg-red-900/60 text-red-100",
};
