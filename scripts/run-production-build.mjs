/**
 * Forces NODE_ENV=production for `next build`.
 * A leftover NODE_ENV=development (shell/env) breaks Next 16 /_global-error prerender
 * with: TypeError: Cannot read properties of null (reading 'useContext').
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextCli = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");

const env = { ...process.env, NODE_ENV: "production" };
delete env.ANNVERO_ANALYSIS_PROFILE;

const result = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: repoRoot,
  env,
  stdio: "inherit",
});

process.exit(result.status === null ? 1 : result.status);
