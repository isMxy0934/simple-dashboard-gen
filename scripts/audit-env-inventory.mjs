import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const outputPath = path.join(rootDir, "docs/audit/env-inventory.md");
const sourceRoots = ["src", "tests"];
const envPattern = /process\.env\.([A-Z][A-Z0-9_]*)/g;
const envObjectPattern = /\benv\.([A-Z][A-Z0-9_]*)/g;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function targetKey(key) {
  if (key === "DATABASE_URL") return "SDS_DATABASE_URL";
  if (key === "DATASOURCE_ENCRYPTION_KEY") return "SDS_DATASOURCE_ENCRYPTION_KEY";
  if (key === "AUTHORING_AGENT_WALL_CLOCK_MS") return "SDS_AUTHORING_AGENT_WALL_CLOCK_MS";
  if (key === "PI_PROVIDER" || key === "PI_MODEL" || key === "PI_THINKING_LEVEL") return `${key} optional fallback for SDS_LLM_*`;
  if (key.endsWith("_API_KEY")) return "provider-auth-env-allowlist.ts passthrough";
  if (key.startsWith("SDS_")) return key;
  return "review required";
}

function recordUsage(usage, key, filePath) {
  const list = usage.get(key) ?? [];
  list.push(path.relative(rootDir, filePath));
  usage.set(key, list);
}

const usage = new Map();
for (const root of sourceRoots) {
  const rootPath = path.join(rootDir, root);
  for (const filePath of await walk(rootPath)) {
    const source = await readFile(filePath, "utf8");
    for (const match of source.matchAll(envPattern)) {
      recordUsage(usage, match[1], filePath);
    }
    for (const match of source.matchAll(envObjectPattern)) {
      recordUsage(usage, match[1], filePath);
    }
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
const lines = [
  "# Environment Variable Inventory",
  "",
  "| Current key | Target handling | Files |",
  "|---|---|---|",
  ...[...usage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, files]) => `| \`${key}\` | ${targetKey(key)} | ${[...new Set(files)].sort().map((file) => `\`${file}\``).join("<br>")} |`),
  "",
];

await writeFile(outputPath, lines.join("\n"));
console.log(`Wrote ${usage.size} env keys to ${path.relative(rootDir, outputPath)}`);
