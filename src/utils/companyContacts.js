export const emptyContact = {
  id: "",
  name: "",
  title: "",
  phone: "",
  whatsapp: "",
  email: "",
  note: "",
  isDefault: false,
};

export function normalizeContact(contact = {}) {
  return {
    id: contact.id || crypto.randomUUID(),
    name: contact.name || "",
    title: contact.title || "",
    phone: contact.phone || "",
    whatsapp: contact.whatsapp || "",
    email: contact.email || "",
    note: contact.note || "",
    isDefault: contact.isDefault === true,
  };
}

function buildLegacyContact(source = {}) {
  const hasLegacy =
    source.contactPerson ||
    source.contactPhone ||
    source.whatsappPhone ||
    source.contactEmail ||
    source.authorizedPerson ||
    source.phone ||
    source.whatsapp ||
    source.email;

  if (!hasLegacy) {
    return null;
  }

  return normalizeContact({
    id: crypto.randomUUID(),
    name: source.contactPerson || source.authorizedPerson || "",
    title: "",
    phone: source.contactPhone || source.phone || "",
    whatsapp: source.whatsappPhone || source.whatsapp || "",
    email: source.contactEmail || source.email || "",
    note: "",
    isDefault: true,
  });
}

export function normalizeContacts(sourceContacts = [], legacySource = {}) {
  let contacts = Array.isArray(sourceContacts)
    ? sourceContacts.map(normalizeContact)
    : [];

  if (contacts.length === 0) {
    const legacyContact = buildLegacyContact(legacySource);
    if (legacyContact) {
      contacts = [legacyContact];
    }
  }

  const defaultContacts = contacts.filter((contact) => contact.isDefault);

  if (contacts.length > 0 && defaultContacts.length === 0) {
    contacts[0] = { ...contacts[0], isDefault: true };
  }

  if (defaultContacts.length > 1) {
    let defaultAssigned = false;
    contacts = contacts.map((contact) => {
      if (contact.isDefault && !defaultAssigned) {
        defaultAssigned = true;
        return contact;
      }

      return { ...contact, isDefault: false };
    });
  }

  return sortContactsWithDefaultFirst(contacts);
}

export function sortContactsWithDefaultFirst(contacts = []) {
  return [...contacts].sort((left, right) => {
    if (left.isDefault === right.isDefault) {
      return (left.name || "").localeCompare(right.name || "", "tr", {
        sensitivity: "base",
      });
    }

    return left.isDefault ? -1 : 1;
  });
}

export function resolveContactWhatsApp(contact = {}) {
  const whatsapp = String(contact.whatsapp || "").trim();
  const phone = String(contact.phone || "").trim();
  return whatsapp || phone;
}
