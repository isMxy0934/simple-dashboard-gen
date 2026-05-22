import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const loadPath = path.join(root, "src/server/config/load.ts");
const allowlistPath = path.join(root, "src/server/config/provider-auth-env-allowlist.ts");
const envExamplePath = path.join(root, ".env.example");
const srcPath = path.join(root, "src");
const allowlistReference = "src/server/config/provider-auth-env-allowlist.ts";

const [loadSource, allowlistSource, envExampleSource] = await Promise.all([
  readFile(loadPath, "utf8"),
  readFile(allowlistPath, "utf8"),
  readFile(envExamplePath, "utf8"),
]);

function collectMatches(source, regex) {
  const matches = new Set();
  for (const match of source.matchAll(regex)) {
    matches.add(match[1]);
  }
  return matches;
}

const schemaKeys = collectMatches(loadSource, /\b([A-Z][A-Z0-9_]*)\s*:/g);
const allowlistKeys = collectMatches(allowlistSource, /"([A-Z0-9_]+_API_KEY)"/g);
const envExampleKeys = collectMatches(envExampleSource, /^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm);

async function walkSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(entryPath)));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(entryPath);
    }
  }

  return files;
}

const sourceFiles = await walkSourceFiles(srcPath);
const sourceEnvKeys = new Set();

for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  for (const key of collectMatches(source, /process\.env\.([A-Z][A-Z0-9_]*)\b/g)) {
    sourceEnvKeys.add(key);
  }
  for (const key of collectMatches(source, /\benv\.([A-Z][A-Z0-9_]*)\b/g)) {
    sourceEnvKeys.add(key);
  }
}

const errors = [];

for (const key of sourceEnvKeys) {
  if (key.startsWith("SDS_") && !schemaKeys.has(key)) {
    errors.push(`SDS source env key ${key} is missing from src/server/config/load.ts`);
  }
}

for (const key of ["PI_PROVIDER", "PI_MODEL", "PI_THINKING_LEVEL"]) {
  if (!schemaKeys.has(key)) {
    errors.push(`${key} is missing from src/server/config/load.ts`);
  }
}

for (const key of allowlistKeys) {
  if (schemaKeys.has(key)) {
    errors.push(`Provider auth key ${key} must not appear in the config schema`);
  }
}

for (const key of schemaKeys) {
  if (!envExampleKeys.has(key)) {
    errors.push(`.env.example is missing schema key ${key}`);
  }
}

const providerAuthByProvider = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};
const exampleProvider = envExampleSource.match(/^\s*SDS_LLM_PROVIDER=([^\s#]+)/m)?.[1]?.trim();
const requiredAuthKey = exampleProvider ? providerAuthByProvider[exampleProvider] : undefined;

if (requiredAuthKey && !envExampleKeys.has(requiredAuthKey)) {
  errors.push(`.env.example is missing auth key ${requiredAuthKey} for SDS_LLM_PROVIDER=${exampleProvider}`);
}

if (!envExampleSource.includes(allowlistReference)) {
  errors.push(`.env.example must mention ${allowlistReference}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("ENV check passed.");
