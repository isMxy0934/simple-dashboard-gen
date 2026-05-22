import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const apiDir = path.join(rootDir, "src/app/api");
const outputPath = path.join(rootDir, "docs/audit/route-inventory.md");
const methodPattern = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
const functionPattern = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/g;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile() && entry.name === "route.ts") {
      files.push(fullPath);
    }
  }
  return files;
}

function routeFromFile(filePath) {
  const relative = path.relative(apiDir, path.dirname(filePath));
  return `/api/${relative.split(path.sep).join("/")}`;
}

function inferIdentitySource(source) {
  const sources = [];
  if (/resolveServerRequestContext/.test(source)) sources.push("resolveServerRequestContext");
  if (/searchParams\.get\(["']workspaceId["']\)/.test(source)) sources.push("searchParams.workspaceId");
  if (/searchParams\.get\(["']userId["']\)/.test(source)) sources.push("searchParams.userId");
  if (
    /request\.json|req\.json/.test(source) &&
    /\.workspaceId\b|\.workspace_id\b|["']workspaceId["']\s+in\b|["']workspace_id["']\s+in\b/.test(source)
  ) {
    sources.push("body workspace");
  }
  if (
    /request\.json|req\.json/.test(source) &&
    /\.userId\b|\.user_id\b|["']userId["']\s+in\b|["']user_id["']\s+in\b/.test(source)
  ) {
    sources.push("body user");
  }
  return sources.length > 0 ? sources.join(" + ") : "none detected";
}

function inferTargetPermission(route, method) {
  if (route.includes("/datasources") && method === "GET") return "datasource.read";
  if (route.includes("/datasources")) return "datasource.manage";
  if (route.includes("/query/execute-batch")) return "dashboard.read or dashboard.edit";
  if (route.includes("/authoring")) return method === "GET" ? "dashboard.read" : "dashboard.edit";
  if (route.includes("/dashboard") || route.includes("/dashboards")) return method === "GET" ? "dashboard.read" : "dashboard.edit";
  if (route.includes("/workspace")) return "workspace.read";
  if (route.includes("/preview")) return "dashboard.read";
  return "dashboard.read";
}

function extractFunctionSource(source, matchIndex) {
  const paramsStart = source.indexOf("(", matchIndex);
  if (paramsStart === -1) return null;

  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (parenDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  if (paramsEnd === -1) return null;

  const bodyStart = source.indexOf("{", paramsEnd);
  if (bodyStart === -1) return null;

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(matchIndex, index + 1);
  }
  return null;
}

function indexFunctionDeclarations(source) {
  const functions = new Map();
  for (const match of source.matchAll(functionPattern)) {
    const body = extractFunctionSource(source, match.index);
    if (body) {
      functions.set(match[1], body);
    }
  }
  return functions;
}

function buildAnalysisSource(functions, functionName, fallbackSource = "") {
  const included = new Set();
  const chunks = [];

  function includeCalledFunctions(source) {
    let found = true;
    while (found) {
      found = false;
      for (const [name, body] of functions) {
        if (included.has(name)) continue;
        const callPattern = new RegExp(`\\b${name}\\s*\\(`);
        if (!callPattern.test(source)) continue;

        included.add(name);
        chunks.push(body);
        source += `\n${body}`;
        found = true;
      }
    }
    return source;
  }

  const handlerSource = functions.get(functionName) ?? fallbackSource;
  if (handlerSource) {
    included.add(functionName);
    chunks.push(handlerSource);
  }
  return includeCalledFunctions(chunks.join("\n"));
}

await mkdir(path.dirname(outputPath), { recursive: true });

const rows = [];
for (const filePath of (await walk(apiDir)).sort()) {
  const source = await readFile(filePath, "utf8");
  const functions = indexFunctionDeclarations(source);
  const matches = [...source.matchAll(methodPattern)];
  for (const match of matches.length > 0 ? matches : [{ 1: "UNKNOWN", index: -1 }]) {
    const method = match[1];
    const route = routeFromFile(filePath);
    const handlerSource =
      method === "UNKNOWN" ? source : buildAnalysisSource(functions, method);
    rows.push({
      route,
      method,
      identity: inferIdentitySource(handlerSource),
      permission: inferTargetPermission(route, method),
    });
  }
}

const lines = [
  "# API Route Inventory",
  "",
  "| Route | HTTP method | Current identity source | Target permission | Sprint 1 migration status |",
  "|---|---:|---|---|---|",
  ...rows.map((row) => `| \`${row.route}\` | ${row.method} | ${row.identity} | ${row.permission} | [ ] |`),
  "",
];

await writeFile(outputPath, lines.join("\n"));
console.log(`Wrote ${rows.length} route rows to ${path.relative(rootDir, outputPath)}`);
