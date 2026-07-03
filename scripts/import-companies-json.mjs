#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const COMPANIES_TABLE = "companies";
const BATCH_SIZE = 50;

function loadEnvFiles() {
  const candidates = [".env.local", ".env"];

  for (const filename of candidates) {
    const filePath = resolve(ROOT_DIR, filename);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const key = match[1];
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function readEnv(name) {
  return String(process.env[name] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function createSupabaseAdminClient() {
  const rawUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!rawUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli (.env.local veya ortam değişkeni)."
    );
  }

  const supabaseUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  const keyFormat = serviceRoleKey.startsWith("sb_secret_")
    ? "secret"
    : serviceRoleKey.startsWith("eyJ")
      ? "jwt"
      : "unknown";

  const fetchWithApiKeyOnly = async (input, init = {}) => {
    const headers = new Headers(init.headers);
    if (keyFormat === "secret" || keyFormat === "publishable") {
      headers.delete("Authorization");
    }
    return fetch(input, { ...init, headers });
  };

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: fetchWithApiKeyOnly,
    },
  });
}

function resolveJsonPath(inputPath) {
  if (!inputPath) {
    throw new Error("JSON dosya yolu gerekli. Örnek: npm run import:companies -- ./annvero-companies-export.json");
  }

  const absolutePath = isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`JSON dosyası bulunamadı: ${absolutePath}`);
  }

  return absolutePath;
}

function extractCompaniesFromJson(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed?.companies)) {
    return parsed.companies;
  }

  if (Array.isArray(parsed?.migrate_api_body?.companies)) {
    return parsed.migrate_api_body.companies;
  }

  throw new Error("JSON içinde companies dizisi bulunamadı.");
}

function getCompanyName(row) {
  return String(
    row?.company_name ||
      row?.companyName ||
      row?.data?.companyName ||
      row?.data?.name ||
      row?.data?.title ||
      row?.name ||
      row?.title ||
      ""
  ).trim();
}

function normalizeCompanyRecord(row) {
  const id = String(row?.id || row?.data?.id || "").trim();
  const companyName = getCompanyName(row);

  if (!id) {
    throw new Error("Geçersiz kayıt: id eksik.");
  }

  if (!companyName) {
    throw new Error(`Geçersiz kayıt (${id}): company_name eksik.`);
  }

  const data =
    row?.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? { ...row.data, id, companyName }
      : { ...row, id, companyName };

  return {
    id,
    company_name: companyName,
    data,
    updated_at: row?.updated_at || new Date().toISOString(),
  };
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function upsertCompanies(supabase, records) {
  const batches = chunkArray(records, BATCH_SIZE);
  let upserted = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const { error } = await supabase.from(COMPANIES_TABLE).upsert(batch, {
      onConflict: "id",
    });

    if (error) {
      throw new Error(`Batch ${index + 1}/${batches.length} upsert hatası: ${error.message}`);
    }

    upserted += batch.length;
    console.log(`Upsert edildi: ${upserted}/${records.length}`);
  }

  return upserted;
}

async function main() {
  loadEnvFiles();

  const inputPath = process.argv[2] || readEnv("COMPANIES_JSON_PATH");
  const jsonPath = resolveJsonPath(inputPath);

  const raw = readFileSync(jsonPath, "utf8");
  const parsed = JSON.parse(raw);
  const sourceRows = extractCompaniesFromJson(parsed);

  const records = [];
  const skipped = [];

  for (const row of sourceRows) {
    try {
      records.push(normalizeCompanyRecord(row));
    } catch (error) {
      skipped.push({
        id: row?.id || null,
        reason: error.message,
      });
    }
  }

  if (!records.length) {
    throw new Error("Import edilecek geçerli firma kaydı bulunamadı.");
  }

  const supabase = createSupabaseAdminClient();
  const projectRef = new URL(readEnv("NEXT_PUBLIC_SUPABASE_URL").startsWith("http")
    ? readEnv("NEXT_PUBLIC_SUPABASE_URL")
    : `https://${readEnv("NEXT_PUBLIC_SUPABASE_URL")}`).hostname.split(".")[0];

  console.log("Import başlıyor...");
  console.log("JSON dosyası:", jsonPath);
  console.log("Supabase projectRef:", projectRef);
  console.log("Kaynak kayıt:", sourceRows.length);
  console.log("Geçerli kayıt:", records.length);
  console.log("Atlanan kayıt:", skipped.length);

  const upserted = await upsertCompanies(supabase, records);

  const { count, error: countError } = await supabase
    .from(COMPANIES_TABLE)
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.warn("Tablo sayımı alınamadı:", countError.message);
  } else {
    console.log("companies tablosu toplam satır:", count);
  }

  console.log("Import tamamlandı.");
  console.log("Upsert edilen kayıt:", upserted);

  if (skipped.length) {
    console.warn("Atlanan kayıtlar:");
    for (const item of skipped) {
      console.warn(`- ${item.id || "?"}: ${item.reason}`);
    }
  }
}

main().catch((error) => {
  console.error("Import başarısız:", error.message);
  process.exit(1);
});
