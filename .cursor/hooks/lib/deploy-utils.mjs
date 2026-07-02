import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const QUEUE_PATH = join(process.cwd(), ".cursor", "deploy-queue.json");

const BLOCKED_PATTERNS = [
  /^\.env/i,
  /\.env\./i,
  /^\.next\//,
  /^node_modules\//,
  /\.pem$/,
  /\.vercel\//,
];

export function runGit(args, options = {}) {
  return execSync(`git ${args}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

export function getRepoRoot() {
  try {
    return runGit("rev-parse --show-toplevel");
  } catch {
    return process.cwd();
  }
}

export function getChangedFiles() {
  try {
    const tracked = runGit("diff --name-only HEAD")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const untracked = runGit("ls-files --others --exclude-standard")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return [...new Set([...tracked, ...untracked])].filter(
      (file) => !BLOCKED_PATTERNS.some((pattern) => pattern.test(file))
    );
  } catch {
    return [];
  }
}

export function hasBlockedFiles(files) {
  return files.filter((file) => BLOCKED_PATTERNS.some((pattern) => pattern.test(file)));
}

export function summarizeChanges(files) {
  if (files.length === 0) return "chore: update project files";

  const groups = {
    feat: [],
    fix: [],
    config: [],
    docs: [],
    other: [],
  };

  for (const file of files) {
    const lower = file.toLowerCase();
    if (lower.includes("fix") || lower.includes("bug")) {
      groups.fix.push(file);
    } else if (
      lower.startsWith("app/") ||
      lower.startsWith("src/") ||
      lower.includes("component")
    ) {
      groups.feat.push(file);
    } else if (
      lower.includes(".cursor/") ||
      lower.includes(".vscode/") ||
      lower.includes(".github/") ||
      lower.includes("config")
    ) {
      groups.config.push(file);
    } else if (lower.endsWith(".md")) {
      groups.docs.push(file);
    } else {
      groups.other.push(file);
    }
  }

  if (groups.feat.length > 0) {
    const focus = groups.feat[0].split("/").pop();
    return `feat: update ${focus} and related changes`;
  }
  if (groups.fix.length > 0) {
    return "fix: apply bug fixes and related updates";
  }
  if (groups.config.length > 0) {
    return "chore: update deployment and project configuration";
  }
  if (groups.docs.length > 0) {
    return "docs: update project documentation";
  }

  return `chore: update ${files.length} file(s)`;
}

export function readDeployQueue() {
  if (!existsSync(QUEUE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function writeDeployQueue(payload) {
  mkdirSync(dirname(QUEUE_PATH), { recursive: true });
  writeFileSync(QUEUE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function refreshDeployQueue(source = "unknown") {
  const files = getChangedFiles();
  if (files.length === 0) {
    if (existsSync(QUEUE_PATH)) {
      writeDeployQueue({
        ready: false,
        files: [],
        message: "",
        updatedAt: new Date().toISOString(),
        source,
      });
    }
    return null;
  }

  const queue = {
    ready: true,
    files,
    message: summarizeChanges(files),
    updatedAt: new Date().toISOString(),
    source,
  };

  writeDeployQueue(queue);
  return queue;
}

export function readHookInput() {
  try {
    if (process.stdin.isTTY) {
      return {};
    }
    const raw = readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function writeHookOutput(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
