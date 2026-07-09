"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

const WHATSAPP_PHONE = "905323637729";
const WHATSAPP_LINK =
  "https://wa.me/905323637729?text=Merhaba%2C%20ANNVERO%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum.";
const WHATSAPP_DEMO_LINK = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(
  "Merhaba ANNVERO ekibi, platform için demo talep etmek istiyorum.",
)}`;
const SUPPORT_PHONE_DISPLAY = "+90 532 363 77 29";
const SUPPORT_EMAIL = "info@annvero.com";

const FAQ_ITEMS = [
  {
    question: "ANNVERO nedir?",
    answer:
      "ANNVERO; muhasebe ofisleri ve işletmeler için mali operasyonları, vergi uyumunu ve otomasyon süreçlerini tek merkezden yönetmeyi sağlayan modern bir platformdur.",
  },
  {
    question: "Demo talep edebilir miyim?",
    answer:
      "Evet. Demo talep et seçeneği ile WhatsApp üzerinden ekibimize ulaşabilir veya iletişim formunu doldurabilirsiniz.",
  },
  {
    question: "Hangi modüller mevcut?",
    answer:
      "Fiş dönüştürme, banka mutabakat, KDV kontrol, kur değerleme, finansman gider kısıtlaması ve daha birçok muhasebe modülü ANNVERO platformunda yer alır.",
  },
  {
    question: "Destek saatleri nedir?",
    answer:
      "Hafta içi 09:00–18:00 arasında destek ekibimiz mesajlarınıza dönüş yapar. Acil talepleriniz için WhatsApp hattımızı kullanabilirsiniz.",
  },
];

const INITIAL_FORM = {
  fullName: "",
  email: "",
  phone: "",
  message: "",
};

function WhatsAppIcon({ className = "h-6 w-6" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-violet-600 transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function AnnveroSupportWidget() {
  const pathname = usePathname();
  const hideOnDataWorkbench =
    pathname?.startsWith("/muhasebe/banka-ekstresi") ||
    pathname?.startsWith("/muhasebe/fis-donusturme");

  const [open, setOpen] = useState(false);
  const [view, setView] = useState("menu");
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  const whatsAppGeneralLink = WHATSAPP_LINK;
  const whatsAppDemoLink = WHATSAPP_DEMO_LINK;

  const resetPanel = useCallback(() => {
    setView("menu");
    setOpenFaqIndex(null);
    setForm(INITIAL_FORM);
    setSubmitting(false);
    setFormError("");
  }, []);

  const closeWidget = useCallback(() => {
    setOpen(false);
    resetPanel();
  }, [resetPanel]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeWidget();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeWidget, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const target = event.target;
      if (
        panelRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      closeWidget();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [closeWidget, open]);

  const handleFormChange = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleFormSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");

    const supabase = getSupabaseClient();
    if (!supabase) {
      setSubmitting(false);
      setFormError("Mesaj gönderilemedi, lütfen tekrar deneyin.");
      return;
    }

    const { error } = await supabase.from("contact_messages").insert([
      {
        name: form.fullName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        message: form.message.trim(),
        source: "contact_widget",
      },
    ]);

    setSubmitting(false);

    if (error) {
      console.error("[ANNVERO Destek] İletişim formu hatası:", error);
      setFormError("Mesaj gönderilemedi, lütfen tekrar deneyin.");
      return;
    }

    setView("success");
  };

  const menuItems = [
    {
      id: "whatsapp",
      label: "WhatsApp ile yaz",
      description: "Hızlı destek için WhatsApp hattımıza yazın",
      href: whatsAppGeneralLink,
      external: true,
      icon: (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <WhatsAppIcon className="h-5 w-5" />
        </span>
      ),
    },
    {
      id: "demo",
      label: "Demo talep et",
      description: "Platform tanıtımı ve demo randevusu",
      href: whatsAppDemoLink,
      external: true,
      icon: (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-lg font-bold">
          D
        </span>
      ),
    },
    {
      id: "faq",
      label: "Sık sorulan sorular",
      description: "ANNVERO hakkında merak edilenler",
      action: () => setView("faq"),
      icon: (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-700 text-lg font-bold">
          ?
        </span>
      ),
    },
    {
      id: "form",
      label: "İletişim formu",
      description: "Mesaj bırakın, size dönelim",
      action: () => setView("form"),
      icon: (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 text-lg font-bold">
          @
        </span>
      ),
    },
  ];

  if (hideOnDataWorkbench) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-start p-4 sm:p-5 lg:justify-end">
      {open ? (
        <div
          ref={panelRef}
          className="pointer-events-auto mb-3 w-full max-w-[min(100%,24rem)] rounded-2xl border border-violet-100 bg-white shadow-2xl shadow-violet-500/10 transition-all duration-200 sm:mb-4 sm:max-w-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="annvero-support-title"
        >
          <div className="rounded-t-2xl bg-gradient-to-r from-violet-700 to-blue-600 px-4 py-4 text-white sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                {view !== "menu" ? (
                  <button
                    type="button"
                    onClick={resetPanel}
                    className="mb-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white/90 transition hover:bg-white/25"
                  >
                    ← Geri
                  </button>
                ) : null}
                <h2 id="annvero-support-title" className="text-lg font-bold">
                  ANNVERO Destek
                </h2>
                <p className="mt-1 text-sm text-violet-100">
                  Size nasıl yardımcı olabiliriz?
                </p>
              </div>
              <button
                type="button"
                onClick={closeWidget}
                aria-label="Destek panelini kapat"
                className="rounded-full bg-white/15 p-2 text-white transition hover:bg-white/25"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
          </div>

          <div className="max-h-[min(70vh,520px)] overflow-y-auto p-3 sm:p-4">
            {view === "menu" ? (
              <ul className="space-y-2">
                {menuItems.map((item) => {
                  const content = (
                    <>
                      {item.icon}
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-sm font-semibold text-slate-900">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {item.description}
                        </span>
                      </span>
                      <svg
                        className="h-4 w-4 shrink-0 text-slate-400"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </>
                  );

                  return (
                    <li key={item.id}>
                      {item.href ? (
                        <a
                          href={item.href}
                          target={item.external ? "_blank" : undefined}
                          rel={item.external ? "noopener noreferrer" : undefined}
                          className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3 transition hover:border-violet-200 hover:bg-violet-50/60"
                        >
                          {content}
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={item.action}
                          className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3 transition hover:border-violet-200 hover:bg-violet-50/60"
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {view === "faq" ? (
              <div className="space-y-2">
                {FAQ_ITEMS.map((item, index) => {
                  const isOpen = openFaqIndex === index;
                  return (
                    <div
                      key={item.question}
                      className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50/70"
                    >
                      <button
                        type="button"
                        onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
                        aria-expanded={isOpen}
                      >
                        <span className="text-sm font-semibold text-slate-900">
                          {item.question}
                        </span>
                        <ChevronIcon open={isOpen} />
                      </button>
                      {isOpen ? (
                        <p className="border-t border-slate-100 px-3 py-3 text-sm leading-relaxed text-slate-600">
                          {item.answer}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {view === "form" ? (
              <form onSubmit={handleFormSubmit} className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Ad Soyad
                  </span>
                  <input
                    type="text"
                    required
                    value={form.fullName}
                    onChange={handleFormChange("fullName")}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    placeholder="Adınız Soyadınız"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    E-posta
                  </span>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={handleFormChange("email")}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    placeholder="ornek@firma.com"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Telefon
                  </span>
                  <input
                    type="tel"
                    required
                    value={form.phone}
                    onChange={handleFormChange("phone")}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    placeholder="05xx xxx xx xx"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Mesaj
                  </span>
                  <textarea
                    required
                    rows={4}
                    value={form.message}
                    onChange={handleFormChange("message")}
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    placeholder="Mesajınızı yazın..."
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-gradient-to-r from-violet-700 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-500/20 transition hover:from-violet-800 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? "Gönderiliyor..." : "Mesajı Gönder"}
                </button>

                {formError ? (
                  <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </p>
                ) : null}
              </form>
            ) : null}

            {view === "success" ? (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-5 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-emerald-900">
                  Mesajınız alındı, en kısa sürede dönüş yapacağız.
                </p>
                <button
                  type="button"
                  onClick={closeWidget}
                  className="mt-4 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  Tamam
                </button>
              </div>
            ) : null}
          </div>

          {view === "menu" ? (
            <div className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500">
              {SUPPORT_EMAIL} · {SUPPORT_PHONE_DISPLAY}
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? "Destek panelini kapat" : "ANNVERO destek panelini aç"}
        aria-expanded={open}
        className={`pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white transition duration-300 focus:outline-none focus:ring-4 focus:ring-emerald-200 sm:h-16 sm:w-16 ${
          open
            ? "shadow-lg shadow-emerald-500/30 hover:scale-105 hover:from-emerald-600 hover:to-emerald-700"
            : "annvero-support-pulse hover:from-emerald-600 hover:to-emerald-700"
        }`}
      >
        {open ? (
          <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        ) : (
          <WhatsAppIcon className="h-7 w-7 sm:h-8 sm:w-8" />
        )}
      </button>
    </div>
  );
}
