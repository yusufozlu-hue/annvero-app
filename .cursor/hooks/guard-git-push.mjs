import {
  readHookInput,
  writeHookOutput,
} from "./lib/deploy-utils.mjs";

const input = readHookInput();
const command = String(input.command || "").trim();

const denyPatterns = [
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+push\b.*--force-with-lease\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bgit\s+push\b.*\s+main\s+--force/i,
];

const askPushPatterns = [/\bgit\s+push\b/i];
const askCommitPatterns = [
  /\bgit\s+commit\b/i,
  /\bnode\s+\.cursor\/hooks\/deploy-approved\.mjs\b/i,
];

for (const pattern of denyPatterns) {
  if (pattern.test(command)) {
    writeHookOutput({
      permission: "deny",
      user_message:
        "Güvenlik nedeniyle bu git komutu otomatik çalıştırılamaz (force push / hard reset / clean).",
      agent_message: "Tehlikeli git komutu engellendi.",
    });
    process.exit(0);
  }
}

for (const pattern of askPushPatterns) {
  if (pattern.test(command)) {
    writeHookOutput({
      permission: "ask",
      user_message:
        "ANNVERO deploy: değişiklikler GitHub'a push edilecek. Vercel otomatik deploy başlatır. Onaylıyor musunuz?",
      agent_message: "Push öncesi kullanıcı onayı gerekiyor.",
    });
    process.exit(0);
  }
}

for (const pattern of askCommitPatterns) {
  if (pattern.test(command)) {
    writeHookOutput({
      permission: "ask",
      user_message:
        "Deploy commit hazırlanacak. Commit mesajını ve dosya listesini kontrol edip onaylayın.",
      agent_message: "Commit öncesi kullanıcı onayı gerekiyor.",
    });
    process.exit(0);
  }
}

writeHookOutput({ permission: "allow" });
