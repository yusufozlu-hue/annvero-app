import { NextResponse } from "next/server";

function formatDate(date: Date) {
  const gun = String(date.getDate()).padStart(2, "0");
  const ay = String(date.getMonth() + 1).padStart(2, "0");
  const yil = date.getFullYear();

  return {
    gun,
    ay,
    yil,
  };
}

async function getKurFromDate(
  date: Date,
  doviz: string
): Promise<number | null> {
  const { gun, ay, yil } = formatDate(date);

  const url = `https://www.tcmb.gov.tr/kurlar/${yil}${ay}/${gun}${ay}${yil}.xml`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const xml = await response.text();

    const regex = new RegExp(
      `<Currency Kod="${doviz}">([\\s\\S]*?)<ForexBuying>(.*?)</ForexBuying>`,
      "i"
    );

    const match = xml.match(regex);

    if (!match) {
      return null;
    }

    const kur = Number(
      match[2]
        .replace(",", ".")
        .trim()
    );

    return kur;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const tarih = searchParams.get("tarih");
  const doviz = searchParams.get("doviz");

  if (!tarih || !doviz) {
    return NextResponse.json({
      error: "Eksik parametre",
    });
  }

  let kontrolTarih = new Date(tarih);

  kontrolTarih.setDate(kontrolTarih.getDate() - 1);

  for (let i = 0; i < 10; i++) {
    const kur = await getKurFromDate(
      kontrolTarih,
      doviz
    );

    if (kur) {
      return NextResponse.json({
        kur,
        tarih: kontrolTarih,
      });
    }

    kontrolTarih.setDate(
      kontrolTarih.getDate() - 1
    );
  }

  return NextResponse.json({
    error: "Kur bulunamadı",
  });
}