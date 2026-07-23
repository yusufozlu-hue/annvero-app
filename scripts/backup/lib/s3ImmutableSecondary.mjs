/**
 * Immutable S3 ikinci hedef — key / Object Lock doğrulama (saf mantık).
 * AWS SDK gerektirmez; unit test ve CLI tarafından kullanılır.
 * Secret basılmaz; DeleteObject yok.
 */

import { createHash } from "node:crypto";

export const IMMUTABLE_RETENTION_DAYS = 35;
export const S3_KEY_PREFIX = "staging";
export const SOURCE_METADATA = "annvero-staging";

export function normalize(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

/** staging/<UTC-YYYY-MM-DD>/<githubRunId>/<fileName> */
export function buildS3ObjectKey({
  dateUtc = new Date(),
  githubRunId = "",
  fileName = "",
} = {}) {
  const runId = normalize(githubRunId);
  const rawName = normalize(fileName);
  if (!runId) throw new Error("githubRunId required");
  if (!rawName || rawName.includes("..")) throw new Error("invalid fileName");
  const name = rawName.replace(/^.*[/\\]/, "");
  if (!name) throw new Error("invalid fileName");
  const d =
    dateUtc instanceof Date
      ? dateUtc.toISOString().slice(0, 10)
      : String(dateUtc).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("invalid dateUtc");
  return `${S3_KEY_PREFIX}/${d}/${runId}/${name}`;
}

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function expectedRetainUntil(now = new Date(), days = IMMUTABLE_RETENTION_DAYS) {
  const ms = Number(days) * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms);
}

/**
 * HeadObject benzeri yanıtı doğrula.
 * @param {object} head - AWS head-object JSON (ObjectLockMode, ObjectLockRetainUntilDate, Metadata, ContentLength)
 * @param {{ sha256Expected: string, contentLength?: number, githubRunId?: string, now?: Date, retentionDays?: number, retainToleranceHours?: number }} opts
 */
export function assertImmutableHeadObject(head, opts = {}) {
  const {
    sha256Expected,
    contentLength,
    githubRunId,
    now = new Date(),
    retentionDays = IMMUTABLE_RETENTION_DAYS,
    retainToleranceHours = 36,
  } = opts;

  if (!head || typeof head !== "object") {
    return { ok: false, code: "HEAD_MISSING", message: "head-object yanıtı yok" };
  }

  const mode = normalize(head.ObjectLockMode || head.objectLockMode).toUpperCase();
  if (mode !== "COMPLIANCE") {
    return {
      ok: false,
      code: "OBJECT_LOCK_MODE",
      message: `ObjectLockMode COMPLIANCE beklenirdi, gelen: ${mode || "(empty)"}`,
    };
  }

  const retainRaw =
    head.ObjectLockRetainUntilDate || head.objectLockRetainUntilDate || "";
  const retainUntil = retainRaw ? new Date(retainRaw) : null;
  if (!retainUntil || Number.isNaN(retainUntil.getTime())) {
    return {
      ok: false,
      code: "RETAIN_UNTIL_MISSING",
      message: "ObjectLockRetainUntilDate yok veya geçersiz",
    };
  }

  const expected = expectedRetainUntil(now, retentionDays);
  const deltaMs = Math.abs(retainUntil.getTime() - expected.getTime());
  const tolMs = retainToleranceHours * 60 * 60 * 1000;
  if (deltaMs > tolMs) {
    return {
      ok: false,
      code: "RETAIN_UNTIL_DRIFT",
      message: `RetainUntil beklenen ~${retentionDays}g sapması fazla (deltaHours=${(deltaMs / 3600000).toFixed(1)})`,
    };
  }

  const meta = head.Metadata || head.metadata || {};
  const metaSha =
    normalize(meta.sha256 || meta.Sha256 || meta["sha256"]) ||
    normalize(head.ChecksumSHA256 ? Buffer.from(head.ChecksumSHA256, "base64").toString("hex") : "");
  // Prefer explicit metadata sha256; ChecksumSHA256 is base64 of binary digest
  let checksumOk = true;
  let checksumSource = "none";
  if (sha256Expected) {
    const expectedHex = normalize(sha256Expected).toLowerCase();
    const fromMeta = normalize(meta.sha256 || meta.Sha256).toLowerCase();
    if (fromMeta) {
      checksumSource = "metadata";
      checksumOk = fromMeta === expectedHex;
    } else if (head.ChecksumSHA256) {
      checksumSource = "ChecksumSHA256";
      const fromAws = Buffer.from(String(head.ChecksumSHA256), "base64").toString("hex");
      checksumOk = fromAws === expectedHex;
    } else {
      return {
        ok: false,
        code: "CHECKSUM_MISSING",
        message: "head-object içinde sha256 metadata / ChecksumSHA256 yok",
      };
    }
    if (!checksumOk) {
      return {
        ok: false,
        code: "CHECKSUM_MISMATCH",
        message: `sha256 uyuşmadı (source=${checksumSource})`,
      };
    }
  }

  if (githubRunId) {
    const metaRun = normalize(meta["github-run-id"] || meta.github_run_id || meta.githubrunid);
    if (metaRun && metaRun !== normalize(githubRunId)) {
      return {
        ok: false,
        code: "GITHUB_RUN_ID_MISMATCH",
        message: "metadata github-run-id uyuşmadı",
      };
    }
  }

  const source = normalize(meta.source);
  if (source && source !== SOURCE_METADATA) {
    return {
      ok: false,
      code: "SOURCE_METADATA",
      message: `metadata source=${source} (beklenen ${SOURCE_METADATA})`,
    };
  }

  if (contentLength != null && head.ContentLength != null) {
    if (Number(head.ContentLength) !== Number(contentLength)) {
      return {
        ok: false,
        code: "CONTENT_LENGTH",
        message: "ContentLength uyuşmadı",
      };
    }
  }

  return {
    ok: true,
    code: "PASS",
    objectLockMode: mode,
    retainUntil: retainUntil.toISOString(),
    checksumSource,
  };
}

/** İndirilen gövde checksum doğrulama */
export function assertDownloadedChecksum(body, sha256Expected) {
  const got = sha256Hex(body).toLowerCase();
  const exp = normalize(sha256Expected).toLowerCase();
  if (!exp || got !== exp) {
    return { ok: false, code: "DOWNLOAD_CHECKSUM_MISMATCH", got, expected: exp };
  }
  return { ok: true, code: "PASS", sha256: got };
}
