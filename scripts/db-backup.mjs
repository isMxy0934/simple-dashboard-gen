import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    outputDir: "/backup",
    databaseUrl: process.env.SDS_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
    label: "pre-sprint",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--output-dir") {
      args.outputDir = argv[++index] ?? "";
      continue;
    }
    if (arg === "--database-url") {
      args.databaseUrl = argv[++index] ?? "";
      continue;
    }
    if (arg === "--label") {
      args.label = argv[++index] ?? "";
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/db-backup.mjs [--dry-run] [--output-dir DIR] [--database-url URL] [--label LABEL]",
    "",
    "Creates a compressed PostgreSQL dump and verifies it with pg_restore --list.",
  ].join("\n");
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function sanitizeLabel(label) {
  const normalized = label.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized || "backup";
}

function redactDatabaseUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "<invalid database url>";
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `${command} failed with status ${result.status}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.databaseUrl) {
    throw new Error("Missing database URL. Pass --database-url or set SDS_DATABASE_URL/DATABASE_URL.");
  }
  if (!args.outputDir) {
    throw new Error("Missing --output-dir.");
  }

  const file = path.join(
    args.outputDir,
    `${sanitizeLabel(args.label)}-${stamp()}.dump`,
  );
  const redactedUrl = redactDatabaseUrl(args.databaseUrl);

  if (args.dryRun) {
    console.log(`pg_dump -Fc -f ${file} ${redactedUrl}`);
    console.log(`pg_restore --list ${file}`);
    return;
  }

  await mkdir(args.outputDir, { recursive: true });
  run("pg_dump", ["-Fc", "-f", file, args.databaseUrl]);
  run("pg_restore", ["--list", file]);
  console.log(`Backup written and verified: ${file}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
