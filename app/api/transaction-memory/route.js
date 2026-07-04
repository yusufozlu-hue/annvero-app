import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  applySuggestionsToCandidates,
  buildLearnPayloadFromQueueItem,
  mapUnrecognizedDbRow,
  toUnrecognizedInsertRow,
  UNRECOGNIZED_STATUS,
} from "@/src/utils/transactionMemoryEngine";

const TABLE = "unrecognized_transactions";
const MEMORY_TABLE = "learning_memory";

function getClient() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      error: NextResponse.json(
        { error: "Supabase istemcisi yapılandırılmamış." },
        { status: 500 }
      ),
    };
  }
  return { supabase };
}

async function loadLearningMemory(supabase, companyId) {
  let query = supabase.from(MEMORY_TABLE).select("*").eq("is_active", true);
  if (companyId) query = query.eq("company_id", companyId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function GET(request) {
  const { supabase, error } = getClient();
  if (error) return error;

  const companyId = request.nextUrl.searchParams.get("companyId");
  const status = request.nextUrl.searchParams.get("status") || UNRECOGNIZED_STATUS.PENDING;

  let query = supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (companyId) query = query.eq("company_id", companyId);
  if (status && status !== "all") query = query.eq("status", status);

  const { data, error: queryError } = await query;
  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  return NextResponse.json({
    data: (data || []).map(mapUnrecognizedDbRow),
  });
}

export async function POST(request) {
  const { supabase, error } = getClient();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const action = String(body?.action || "queue").trim();

  if (action === "queue") {
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) {
      return NextResponse.json({ error: "Kuyruğa alınacak işlem yok." }, { status: 400 });
    }

    const companyId = items[0]?.companyId;
    let learningMemory = [];
    try {
      learningMemory = await loadLearningMemory(supabase, companyId);
    } catch (memoryError) {
      console.error("[transaction-memory] learning_memory load failed", memoryError);
    }

    const enriched = applySuggestionsToCandidates(items, learningMemory);
    const insertRows = enriched.map(toUnrecognizedInsertRow);

    const existingQuery = supabase
      .from(TABLE)
      .select("id, company_id, source_row_id, raw_description, transaction_date, amount")
      .eq("status", UNRECOGNIZED_STATUS.PENDING)
      .eq("company_id", companyId);

    const { data: existingRows } = await existingQuery;
    const existingKeys = new Set(
      (existingRows || []).map((row) =>
        [
          row.company_id,
          row.source_row_id || "",
          row.raw_description || "",
          row.transaction_date || "",
          String(row.amount ?? ""),
        ].join("|")
      )
    );

    const freshRows = insertRows.filter((row) => {
      const key = [
        row.company_id,
        row.source_row_id || "",
        row.raw_description || "",
        row.transaction_date || "",
        String(row.amount ?? ""),
      ].join("|");
      return !existingKeys.has(key);
    });

    if (!freshRows.length) {
      return NextResponse.json({
        ok: true,
        inserted: 0,
        skipped: insertRows.length,
        message: "Yeni tanınmayan işlem yok.",
      });
    }

    const { data, error: insertError } = await supabase
      .from(TABLE)
      .insert(freshRows)
      .select("*");

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      inserted: (data || []).length,
      skipped: insertRows.length - (data || []).length,
      data: (data || []).map(mapUnrecognizedDbRow),
    });
  }

  if (action === "learn") {
    const id = String(body?.id || "").trim();
    if (!id) {
      return NextResponse.json({ error: "Kayıt id zorunludur." }, { status: 400 });
    }

    const { data: queueItem, error: readError } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return NextResponse.json({ error: readError.message }, { status: 500 });
    }

    if (!queueItem) {
      return NextResponse.json({ error: "Kayıt bulunamadı." }, { status: 404 });
    }

    const memoryPayload = buildLearnPayloadFromQueueItem(queueItem, body?.draft || {});

    if (!memoryPayload.company_id || !memoryPayload.keyword) {
      return NextResponse.json(
        { error: "Firma ve anahtar kelime zorunludur." },
        { status: 400 }
      );
    }

    if (!memoryPayload.account_code) {
      return NextResponse.json({ error: "Hesap kodu zorunludur." }, { status: 400 });
    }

    const insertMemory = {
      ...memoryPayload,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let memoryRow = null;
    let memoryError = null;

    ({ data: memoryRow, error: memoryError } = await supabase
      .from(MEMORY_TABLE)
      .insert([insertMemory])
      .select("*")
      .maybeSingle());

    // Yeni kolonlar henüz migrate edilmemişse çekirdek alanlarla dene.
    if (memoryError) {
      const legacyPayload = {
        company_id: memoryPayload.company_id,
        keyword: memoryPayload.keyword,
        account_code: memoryPayload.account_code,
        account_name: memoryPayload.account_name,
        counter_account_code: memoryPayload.counter_account_code,
        counter_account_name: memoryPayload.counter_account_name,
        document_type: memoryPayload.document_type,
        transaction_type: memoryPayload.transaction_type,
        description_format: memoryPayload.description_format,
        source_module: memoryPayload.source_module,
        usage_count: 0,
        is_active: true,
        created_at: insertMemory.created_at,
        updated_at: insertMemory.updated_at,
      };

      ({ data: memoryRow, error: memoryError } = await supabase
        .from(MEMORY_TABLE)
        .insert([legacyPayload])
        .select("*")
        .maybeSingle());
    }

    if (memoryError) {
      return NextResponse.json({ error: memoryError.message }, { status: 500 });
    }

    const { data: updatedQueue, error: updateError } = await supabase
      .from(TABLE)
      .update({
        status: UNRECOGNIZED_STATUS.LEARNED,
        account_code: memoryPayload.account_code,
        account_name: memoryPayload.account_name,
        document_type: memoryPayload.document_type,
        cari_name: memoryPayload.cari_name,
        clean_description: memoryPayload.clean_description,
        keyword: memoryPayload.keyword,
        user_correction: memoryPayload.user_correction,
        learned_memory_id: memoryRow?.id || null,
        learned_at: memoryPayload.learned_at,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      data: mapUnrecognizedDbRow(updatedQueue),
      memory: memoryRow,
    });
  }

  return NextResponse.json({ error: "Geçersiz action." }, { status: 400 });
}

export async function PATCH(request) {
  const { supabase, error } = getClient();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const id = String(body?.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Kayıt id zorunludur." }, { status: 400 });
  }

  const payload = { updated_at: new Date().toISOString() };
  const fieldMap = {
    status: "status",
    accountCode: "account_code",
    accountName: "account_name",
    documentType: "document_type",
    cariName: "cari_name",
    cleanDescription: "clean_description",
    keyword: "keyword",
    userCorrection: "user_correction",
  };

  for (const [inputKey, column] of Object.entries(fieldMap)) {
    if (body[inputKey] !== undefined) {
      payload[column] = body[inputKey];
    }
  }

  const { data, error: updateError } = await supabase
    .from(TABLE)
    .update(payload)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ data: mapUnrecognizedDbRow(data) });
}
