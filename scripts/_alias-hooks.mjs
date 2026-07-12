import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function resolveExistingPath(basePath) {
  const clean = basePath.replace(/\\/g, path.sep);
  if (fs.existsSync(clean) && fs.statSync(clean).isFile()) return clean;
  for (const ext of [".js", ".ts", ".mjs", ".tsx"]) {
    const candidate = `${clean}${ext}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const ext of [".js", ".ts"]) {
    const candidate = path.join(clean, `index${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2).replace(/\\/g, "/");
    const abs = resolveExistingPath(path.join(ROOT, rel));
    if (abs) return nextResolve(pathToFileURL(abs).href, context);
  }

  if (specifier.startsWith(".") && !path.extname(specifier.split("?")[0])) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const abs = resolveExistingPath(path.resolve(parentDir, specifier));
    if (abs) return nextResolve(pathToFileURL(abs).href, context);
  }

  return nextResolve(specifier, context);
}
