import AnnveroLogo from "@/app/components/AnnveroLogo";

export default function PublicSiteFooter() {
  return (
    <footer className="border-t border-violet-100 bg-slate-900 px-4 py-10 text-slate-300 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <AnnveroLogo onLight={false} size={36} />
        <p className="mt-3 text-sm text-slate-400">
          Muhasebe ve vergi yönetiminde akıllı dönüşüm.
        </p>
      </div>
    </footer>
  );
}
