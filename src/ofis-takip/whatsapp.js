export function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith("90") && digits.length >= 12) {
    return digits;
  }

  if (digits.startsWith("0")) {
    return `90${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `90${digits}`;
  }

  return digits;
}

export function applyWhatsAppTemplate(template, variables = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_match, key) => {
    return variables[key] ?? "";
  });
}

export function buildWhatsAppLink(phone, message) {
  const normalizedPhone = normalizePhoneForWhatsApp(phone);

  if (!normalizedPhone) {
    return "";
  }

  const text = encodeURIComponent(String(message || "").trim());
  return `https://wa.me/${normalizedPhone}?text=${text}`;
}
