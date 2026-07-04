import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  applySuggestionsToCandidates,
  buildLearnPayloadFromQueueItem,
  buildUnrecognizedFingerprint,
  mapUnrecognizedDbRow,
  toUnrecognizedInsertRow,
  UNRECOGNIZED_STATUS,
} from "@/src/utils/transactionMemoryEngine";
import {
  buildSafeLearningMemoryPayload,
  isLearningMemorySchemaError,
  LEARNING_MEMORY_SCHEMA_MESSAGE,
} from "@/src/utils/learningMemorySafePayload";

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
  let query = supabase.from(MEMORY_TABLE).select("*").neq("status", "passive");
  query = query.neq("status", "deleted");
  if (companyId) query = query.eq("company_id", companyId);
  let { data, error } = await query;
  if (error && isLearningMemorySchemaError(error)) {
    let fallbackQuery = supabase.from(MEMORY_TABLE).select("*");
    if (companyId) fallbackQuery = fallbackQuery.eq("company_id", companyId);
    ({ data, error } = await fallbackQuery);
  }
  if (error) throw new Error(error.message);
  return (data || []).filter(
    (row) =>
      row?.is_active !== false &&
      !["passive", "deleted"].includes(
        String(row?.status || "active").toLowerCase()
      )
  );
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

    const { data: existingRows, error: existingError } = await supabase
      .from(TABLE)
      .select("*")
      .eq("company_id", companyId)
      .in("status", [UNRECOGNIZED_STATUS.PENDING, UNRECOGNIZED_STATUS.LEARNED]);

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const existingByFingerprint = new Map();
    for (const row of existingRows || []) {
      const fingerprint = buildUnrecognizedFingerprint(row);
      if (!existingByFingerprint.has(fingerprint)) {
        existingByFingerprint.set(fingerprint, row);
      }
    }

    const freshRows = [];
    let skipped = 0;
    let updated = 0;

    for (const item of enriched) {
      const insertRow = toUnrecognizedInsertRow(item);
      const fingerprint =
        item.fingerprint || buildUnrecognizedFingerprint(insertRow);
      const existing = existingByFingerprint.get(fingerprint);

      if (existing) {
        skipped += 1;

        // Bekleyen kaydın önerilerini güncelle (duplicate insert yok)
        if (
          existing.status === UNRECOGNIZED_STATUS.PENDING &&
          (insertRow.suggested_account_code || insertRow.suggested_document_type)
        ) {
          const { error: updateError } = await supabase
            .from(TABLE)
            .update({
              suggested_account_code:
                insertRow.suggested_account_code || existing.suggested_account_code,
              suggested_account_name:
                insertRow.suggested_account_name || existing.suggested_account_name,
              suggested_document_type:
                insertRow.suggested_document_type || existing.suggested_document_type,
              suggested_cari: insertRow.suggested_cari || existing.suggested_cari,
              suggested_memory_id:
                insertRow.suggested_memory_id || existing.suggested_memory_id,
              suggestion_score:
                insertRow.suggestion_score ?? existing.suggestion_score,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);

          if (!updateError) updated += 1;
        }
        continue;
      }

      freshRows.push(insertRow);
      existingByFingerprint.set(fingerprint, insertRow);
    }

    if (!freshRows.length) {
      return NextResponse.json({
        ok: true,
        inserted: 0,
        updated,
        skipped,
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
      updated,
      skipped,
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

    const insertMemory = buildSafeLearningMemoryPayload({
      ...memoryPayload,
      clean_description:
        memoryPayload.clean_description || memoryPayload.description_format || "",
      bank_name: queueItem.source_bank || "",
      amount: queueItem.amount ?? null,
      status: "active",
    });

    console.log("learning memory safe payload", insertMemory);

    let memoryRow = null;
    let memoryError = null;

    ({ data: memoryRow, error: memoryError } = await supabase
      .from(MEMORY_TABLE)
      .insert([insertMemory])
      .select("*")
      .maybeSingle());

    if (memoryError) {
      console.error(memoryError);
      return NextResponse.json(
        {
          error: isLearningMemorySchemaError(memoryError)
            ? LEARNING_MEMORY_SCHEMA_MESSAGE
            : memoryError.message,
        },
        { status: 500 }
      );
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
