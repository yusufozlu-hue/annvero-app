import { getGibEncryptionKeyErrorMessage } from "@/src/lib/gibCredentialsEnv";

export function getGibEncryptionKeyGuardResponse() {
  const error = getGibEncryptionKeyErrorMessage();
  if (!error) return null;

  return Response.json({ error }, { status: 500 });
}
