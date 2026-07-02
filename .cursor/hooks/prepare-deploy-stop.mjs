import {
  getChangedFiles,
  readDeployQueue,
  readHookInput,
  refreshDeployQueue,
  writeHookOutput,
} from "./lib/deploy-utils.mjs";

const input = readHookInput();
const status = input.status || "completed";
const loopCount = Number(input.loop_count || 0);

if (status !== "completed") {
  writeHookOutput({});
  process.exit(0);
}

const queue = refreshDeployQueue("stop") || readDeployQueue();

if (!queue?.ready || !Array.isArray(queue.files) || queue.files.length === 0) {
  writeHookOutput({});
  process.exit(0);
}

if (loopCount > 0) {
  writeHookOutput({});
  process.exit(0);
}

const fileCount = queue.files.length;
const preview = queue.files.slice(0, 4).join(", ");
const suffix = fileCount > 4 ? ` (+${fileCount - 4} daha)` : "";

writeHookOutput({
  followup_message:
    `Deploy hazır: ${fileCount} dosya değişti (${preview}${suffix}). ` +
    `Önerilen commit: "${queue.message}". ` +
    `GitHub'a göndermek için **deploy onayla** yazın. Vazgeçmek için yok sayın.`,
});
