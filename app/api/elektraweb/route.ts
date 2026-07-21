import { NextRequest, NextResponse } from "next/server";
import { processElektrawebFile } from "@/src/utils/elektrawebProcessor";
import { requireApiSession } from "@/src/lib/auth/apiGuard";
import { enforceDurableRateLimit } from "@/src/lib/security/rateLimitDurable";
import { enforceSameOriginCsrf } from "@/src/lib/security/csrf";
import {
  validateUploadFile,
  DEFAULT_MAX_UPLOAD_BYTES,
} from "@/src/lib/security/uploadGuard";
import { getOrCreateRequestId, REQUEST_ID_HEADER } from "@/src/lib/security/requestId";
import { safeErrorMessage } from "@/src/lib/security/redact";

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req);

  const session = await requireApiSession();
  if (session.error) {
    session.error.headers.set(REQUEST_ID_HEADER, requestId);
    return session.error;
  }

  const csrfError = enforceSameOriginCsrf(req);
  if (csrfError) {
    csrfError.headers.set(REQUEST_ID_HEADER, requestId);
    return csrfError;
  }

  const rateLimited = await enforceDurableRateLimit(
    req,
    session,
    "elektraweb:upload",
    { limit: 20, windowMs: 300_000 }
  );
  if (rateLimited) {
    rateLimited.headers.set(REQUEST_ID_HEADER, requestId);
    return rateLimited;
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Dosya bulunamadı", requestId },
        { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = new Uint8Array(bytes);

    const validation = validateUploadFile({
      fileName: file.name,
      mimeType: file.type,
      size: file.size || buffer.byteLength,
      buffer,
      maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      allowedExtensions: [".xlsx", ".xls", ".csv", ".xml", ".txt"],
    });

    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error, requestId },
        { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
      );
    }

    const matchingContextRaw = formData.get("matchingContext");
    let matchingContext: Record<string, unknown> = {};

    if (matchingContextRaw) {
      try {
        matchingContext = JSON.parse(String(matchingContextRaw));
      } catch {
        console.warn("[elektraweb-route] matchingContext JSON parse failed", { requestId });
      }
    }

    // Client privilege claim'lerini yok say
    if (matchingContext && typeof matchingContext === "object") {
      delete matchingContext.role;
      delete matchingContext.isAdmin;
      delete matchingContext.isManagementUser;
    }

    const result = processElektrawebFile(bytes, matchingContext);

    return NextResponse.json(
      {
        success: true,
        ...result,
        requestId,
      },
      { headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  } catch (error) {
    console.error("[elektraweb-route]", { requestId, message: safeErrorMessage(error) });
    return NextResponse.json(
      { error: "İşlem hatası", requestId },
      { status: 500, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }
}
