import Image from "next/image";

// ANNVERO marka logosu — tek kaynak bileşen.
// Flat logo: public/annvero-logo.png
// App icon:  public/annvero-icon.png
//
// Kullanım:
//   <AnnveroLogo size={42} />                 -> açık zeminde flat logo (navbar)
//   <AnnveroLogo size={30} onLight={false} /> -> koyu zeminde compact (sidebar/menu)
//   <AnnveroLogo variant="icon" size={32} />  -> yalnızca kare ikon

const LOGO_SRC = "/annvero-logo.png";
const ICON_SRC = "/annvero-icon.png";

export default function AnnveroLogo({
  size = 42,
  onLight = true,
  variant = "flat",
  className = "",
  priority = false,
}) {
  const src = variant === "icon" ? ICON_SRC : LOGO_SRC;

  const image = (
    <Image
      src={src}
      alt="ANNVERO"
      width={0}
      height={0}
      sizes="240px"
      priority={priority}
      // width={0}/height={0} + sizes ile gerçek en-boy oranı korunur; yalnız yükseklik sabitlenir.
      style={{ height: `${size}px`, width: "auto" }}
    />
  );

  // Koyu zeminde flat logonun okunur kalması için temiz beyaz yüzey.
  if (!onLight && variant !== "icon") {
    return (
      <span
        className={`inline-flex items-center rounded-lg bg-white px-3 py-1.5 shadow-sm ${className}`}
      >
        {image}
      </span>
    );
  }

  return <span className={`inline-flex items-center ${className}`}>{image}</span>;
}
