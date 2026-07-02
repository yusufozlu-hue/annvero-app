import { NextResponse } from "next/server";
import { requireAdminUser } from "@/src/lib/supabase/serverAuth";
import {
  mevzuatParametreleriService,
  SEED_FALLBACK_NOTICE,
} from "@/src/services/mevzuatParametreleriService";
import { getSeedParametersByModule } from "@/src/config/mevzuatParameterSeedData";

export async function GET(request) {
  const { supabase, user, error } = await requireAdminUser();

  if (error === "unauthenticated") {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  if (error === "forbidden") {
    return NextResponse.json(
      { error: "Bu işlem için admin yetkisi gerekli." },
      { status: 403 }
    );
  }

  const moduleKey = request.nextUrl.searchParams.get("module_key");
  if (!moduleKey) {
    return NextResponse.json({ error: "module_key zorunludur." }, { status: 400 });
  }

  try {
    const result = await mevzuatParametreleriService.listModuleParameters(
      supabase,
      moduleKey
    );

    return NextResponse.json({
      rows: result.rows || [],
      meta: result.meta || {
        source: "seed",
        notice: SEED_FALLBACK_NOTICE,
        supabaseConnected: Boolean(supabase),
      },
      user: user.email,
    });
  } catch (err) {
    console.error("[GET /api/admin/mevzuat-parametreleri]", err);

    const fallbackRows = getSeedParametersByModule(moduleKey).map((row) => ({
      ...row,
      source: "config",
    }));

    return NextResponse.json({
      rows: fallbackRows,
      meta: {
        source: "seed",
        notice: SEED_FALLBACK_NOTICE,
        supabaseConnected: Boolean(supabase),
      },
      user: user.email,
    });
  }
}

export async function PUT(request) {
  const { supabase, error } = await requireAdminUser();

  if (error === "unauthenticated") {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  if (error === "forbidden") {
    return NextResponse.json(
      { error: "Bu işlem için admin yetkisi gerekli." },
      { status: 403 }
    );
  }

  try {
    const payload = await request.json();
    const result = await mevzuatParametreleriService.saveParameter(supabase, payload);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.code === "SUPABASE_TABLE_MISSING") {
      return NextResponse.json(
        {
          error:
            "Supabase mevzuat_parametreleri tablosu henüz oluşturulmamış. SQL migration dosyasını çalıştırın.",
          notice: SEED_FALLBACK_NOTICE,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Parametre kaydedilemedi." },
      { status: 500 }
    );
  }
}
