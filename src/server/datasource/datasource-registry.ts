import "server-only";

import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

export interface DatasourceRegistryEntry {
  id: string;
  label: string;
  description: string;
  postgres_url: string;
  created_at: string;
}

interface RegistryFile {
  entries: DatasourceRegistryEntry[];
}

const BUILTIN_IDS = new Set(["ds_sales_weekly"]);

function registryPath() {
  return join(process.cwd(), "data", "datasource-registry.json");
}

async function ensureDataDir() {
  const dir = join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
}

export function isBuiltinDatasourceId(id: string): boolean {
  return BUILTIN_IDS.has(id);
}

export async function readDatasourceRegistry(): Promise<DatasourceRegistryEntry[]> {
  try {
    const raw = await readFile(registryPath(), "utf8");
    const parsed = JSON.parse(raw) as RegistryFile;
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export async function writeDatasourceRegistry(entries: DatasourceRegistryEntry[]): Promise<void> {
  await ensureDataDir();
  const payload: RegistryFile = { entries };
  await writeFile(registryPath(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function appendDatasourceEntry(input: {
  label: string;
  description: string;
  postgres_url: string;
}): Promise<DatasourceRegistryEntry> {
  const entries = await readDatasourceRegistry();
  const entry: DatasourceRegistryEntry = {
    id: `ds_${randomUUID().replace(/-/g, "")}`,
    label: input.label.trim(),
    description: input.description.trim(),
    postgres_url: input.postgres_url.trim(),
    created_at: new Date().toISOString(),
  };
  entries.push(entry);
  await writeDatasourceRegistry(entries);
  return entry;
}

export async function removeDatasourceEntry(id: string): Promise<boolean> {
  if (isBuiltinDatasourceId(id)) {
    return false;
  }
  const entries = await readDatasourceRegistry();
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) {
    return false;
  }
  await writeDatasourceRegistry(next);
  return true;
}

export async function getRegistryEntryById(
  id: string,
): Promise<DatasourceRegistryEntry | undefined> {
  const entries = await readDatasourceRegistry();
  return entries.find((entry) => entry.id === id);
}
