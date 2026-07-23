import { getGibEncryptionKeyErrorMessage } from "@/src/lib/gibCredentialsEnv";

/** Config unavailable — sanitize; secret/key ayrıntısı yok. */
export function getGibEncryptionKeyGuardResponse() {
  const error = getGibEncryptionKeyErrorMessage();
  if (!error) return null;

  // Global Response.json — NextResponse'a ihtiyaç yok; test/runtime uyumlu.
  return Response.json(
    { error: "Servis geçici olarak kullanılamıyor." },
    { status: 503 }
  );
}
