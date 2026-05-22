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

function parseActiveEnvExample(source) {
  const env = {};

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith("\"") && value.endsWith("\""))
    ) {
      env[key] = value.slice(1, -1);
    } else {
      env[key] = value;
    }
  }

  return env;
}

function parseJsonValue(key, value, validationErrors) {
  try {
    return JSON.parse(value);
  } catch {
    validationErrors.push(`${key} must be valid JSON`);
    return undefined;
  }
}

function validatePositiveInteger(key, value, validationErrors) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    validationErrors.push(`${key} must be a positive integer`);
  }
}

function validateCsv(key, value, validationErrors) {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    validationErrors.push(`${key} must contain at least one value`);
  }
}

function validateActiveEnvExample(env) {
  const validationErrors = [];
  const requiredActiveKeys = [
    "SDS_SESSION_SECRETS",
    "SDS_ALLOWED_ORIGINS",
    "SDS_DATABASE_URL",
  ];

  for (const key of requiredActiveKeys) {
    if (env[key] === undefined || env[key] === "") {
      validationErrors.push(`${key} must have an active .env.example value`);
    }
  }

  const sessionSecrets = parseJsonValue("SDS_SESSION_SECRETS", env.SDS_SESSION_SECRETS ?? "", validationErrors);
  if (sessionSecrets !== undefined) {
    if (typeof sessionSecrets?.current?.kid !== "string" || sessionSecrets.current.kid.length < 1) {
      validationErrors.push("SDS_SESSION_SECRETS current.kid must be a nonempty string");
    }
    if (typeof sessionSecrets?.current?.secret !== "string" || sessionSecrets.current.secret.length < 32) {
      validationErrors.push("SDS_SESSION_SECRETS current.secret must be at least 32 characters");
    }
    if (!Array.isArray(sessionSecrets?.previous)) {
      validationErrors.push("SDS_SESSION_SECRETS previous must be an array");
    } else {
      sessionSecrets.previous.forEach((previousSecret, index) => {
        if (typeof previousSecret?.kid !== "string" || previousSecret.kid.length < 1) {
          validationErrors.push(`SDS_SESSION_SECRETS previous[${index}].kid must be a nonempty string`);
        }
        if (typeof previousSecret?.secret !== "string" || previousSecret.secret.length < 32) {
          validationErrors.push(`SDS_SESSION_SECRETS previous[${index}].secret must be at least 32 characters`);
        }
      });
    }
  }

  for (const key of schemaKeys) {
    if (key.startsWith("SDS_QUOTA_") || key === "SDS_SESSION_TTL_DAYS" || key === "SDS_SESSION_REFRESH_GRACE_HOURS") {
      validatePositiveInteger(key, env[key], validationErrors);
    }
  }

  for (const key of ["SDS_ALLOWED_ORIGINS", "SDS_OBSERVABILITY_SINKS"]) {
    validateCsv(key, env[key] ?? "", validationErrors);
  }

  for (const key of ["SDS_LLM_THINKING_LEVEL", "PI_THINKING_LEVEL"]) {
    if (env[key] !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh"].includes(env[key])) {
      validationErrors.push(`${key} must be a supported thinking level`);
    }
  }

  return validationErrors;
}

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

const activeEnvExample = parseActiveEnvExample(envExampleSource);
const activeEnvErrors = validateActiveEnvExample(activeEnvExample);
for (const error of activeEnvErrors) {
  errors.push(`.env.example active values are invalid: ${error}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("ENV check passed.");
