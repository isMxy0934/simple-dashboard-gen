import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const logsDir = path.join(rootDir, "logs/sessions");
const outputPath = path.join(rootDir, "docs/audit/event-inventory.md");
const readLocalLogs =
  process.env.AUDIT_EVENT_LOCAL_LOGS === "1" ||
  process.argv.includes("--local-logs");

async function walkJsonl(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walkJsonl(fullPath));
      } else if (entry.isFile() && entry.name === "trace.jsonl") {
        files.push(fullPath);
      }
    }
    return files;
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

const counts = new Map();
for (const filePath of readLocalLogs ? await walkJsonl(logsDir) : []) {
  const content = await readFile(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const name = [event.scope, event.event].filter(Boolean).join(".");
      counts.set(name || "unknown", (counts.get(name || "unknown") ?? 0) + 1);
    } catch {
      counts.set("invalid-json", (counts.get("invalid-json") ?? 0) + 1);
    }
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const lines =
  rows.length === 0
    ? [
        "# Event Inventory",
        "",
        "_No committed event fixture found. Ignored local logs are skipped by default; run with AUDIT_EVENT_LOCAL_LOGS=1 or --local-logs to audit local traces._",
        "",
      ]
    : [
        "# Event Inventory",
        "",
        "| Event | Count |",
        "|---|---:|",
        ...rows.map(([event, count]) => `| \`${event}\` | ${count} |`),
        "",
      ];

await writeFile(outputPath, lines.join("\n"));
console.log(`Wrote ${rows.length} event rows to ${path.relative(rootDir, outputPath)}`);
