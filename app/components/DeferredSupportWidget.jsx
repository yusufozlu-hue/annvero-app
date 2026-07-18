"use client";

import dynamic from "next/dynamic";

const AnnveroSupportWidget = dynamic(
  () => import("@/app/components/AnnveroSupportWidget"),
  { ssr: false }
);

/** Kök layout için destek widget'ını kritik render yolundan çıkarır. */
export default function DeferredSupportWidget() {
  return <AnnveroSupportWidget />;
}
