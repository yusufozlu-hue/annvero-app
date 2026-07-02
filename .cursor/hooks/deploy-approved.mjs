import { execSync, spawnSync } from "node:child_process";
import {
  getChangedFiles,
  hasBlockedFiles,
  readDeployQueue,
  refreshDeployQueue,
  runGit,
  summarizeChanges,
  writeDeployQueue,
} from "./lib/deploy-utils.mjs";

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

const argMessage = process.argv.slice(2).join(" ").trim();
let queue = readDeployQueue();
const files = getChangedFiles();

if (files.length === 0) {
  fail("Deploy edilecek değişiklik bulunamadı.");
}

const blocked = hasBlockedFiles(files);
if (blocked.length > 0) {
  fail(`Güvenli olmayan dosyalar commit edilemez: ${blocked.join(", ")}`);
}

if (!queue?.ready) {
  queue = refreshDeployQueue("manual");
}

const commitMessage = argMessage || queue?.message || summarizeChanges(files);

try {
  const stage = spawnSync("git", ["add", "--", ...files], { stdio: "inherit" });
  if (stage.status !== 0) {
    fail("Stage işlemi başarısız oldu.");
  }
} catch (error) {
  fail(`Stage hatası: ${error.message}`);
}

try {
  execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
    stdio: "inherit",
  });
} catch (error) {
  fail(`Commit hatası: ${error.message}`);
}

try {
  execSync("git push origin HEAD", { stdio: "inherit" });
} catch (error) {
  fail(`Push hatası: ${error.message}`);
}

const shortHash = runGit("rev-parse --short HEAD");

writeDeployQueue({
  ready: false,
  files: [],
  message: "",
  updatedAt: new Date().toISOString(),
  lastDeploy: {
    commit: shortHash,
    message: commitMessage,
    pushedAt: new Date().toISOString(),
  },
});

ok(`Deploy tamamlandı. Commit: ${shortHash}`);
ok("Vercel otomatik deploy başlatıldı.");
ok(`Dashboard'da build hash '${shortHash}' olarak görünmeli.`);
