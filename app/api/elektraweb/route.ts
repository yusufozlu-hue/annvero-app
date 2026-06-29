import { NextRequest, NextResponse } from "next/server";
import { processElektrawebFile } from "@/src/utils/elektrawebProcessor";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 400 });
    }

    const matchingContextRaw = formData.get("matchingContext");
    let matchingContext: Record<string, unknown> = {};

    if (matchingContextRaw) {
      try {
        matchingContext = JSON.parse(String(matchingContextRaw));
      } catch {
        console.warn("[elektraweb-route] matchingContext JSON parse failed");
      }
    }

    const bytes = await file.arrayBuffer();
    const result = processElektrawebFile(bytes, matchingContext);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "İşlem hatası" }, { status: 500 });
  }
}
