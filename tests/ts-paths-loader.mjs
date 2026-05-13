import { stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function resolveCandidate(filePath) {
  const candidates = [
    filePath,
    `${filePath}.ts`,
    `${filePath}.tsx`,
    path.join(filePath, "index.ts"),
    path.join(filePath, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

// Stub packages that are only meaningful in a Next.js server runtime.
const SERVER_ONLY_STUBS = new Set(["server-only", "client-only"]);

export async function resolve(specifier, context, nextResolve) {
  if (SERVER_ONLY_STUBS.has(specifier)) {
    return { url: "data:text/javascript,", shortCircuit: true };
  }

  if (specifier.startsWith("@/")) {
    const resolved = await resolveCandidate(
      path.join(rootDir, "src", specifier.slice(2)),
    );
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parentPath = context.parentURL
      ? path.dirname(fileURLToPath(context.parentURL))
      : rootDir;
    const resolved = await resolveCandidate(path.resolve(parentPath, specifier));
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
