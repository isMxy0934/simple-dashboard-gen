import { readdir, readFile } from "fs/promises";
import path from "path";
import type {
  DashboardAgentSkillSummary,
  LoadSkillReferenceToolOutput,
  LoadSkillToolOutput,
} from "@/ai/dashboard-agent/contracts/agent-contract";

const INTERNAL_SKILLS_ROOT = path.join(
  process.cwd(),
  "src",
  "ai",
  "dashboard-agent",
  "skills",
);

interface SkillFrontmatter {
  name: string;
  description: string;
}

interface ParsedSkillFile {
  metadata: SkillFrontmatter;
  body: string;
}

function parseSkillFrontmatter(content: string, filePath: string): ParsedSkillFile {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Skill file "${filePath}" must start with YAML frontmatter.`);
  }

  const [, rawFrontmatter, body] = match;
  const entries = rawFrontmatter
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const metadata = new Map<string, string>();

  for (const entry of entries) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    metadata.set(key, value);
  }

  const name = metadata.get("name");
  const description = metadata.get("description");

  if (!name || !description) {
    throw new Error(
      `Skill file "${filePath}" must declare both "name" and "description" in frontmatter.`,
    );
  }

  return {
    metadata: {
      name,
      description,
    },
    body: body.trim(),
  };
}

function normalizeReferenceName(referenceName: string) {
  return referenceName.trim().replace(/\.md$/i, "");
}

async function readSkill(skillId: string): Promise<{
  directory: string;
  parsed: ParsedSkillFile;
} | null> {
  const skillDirectory = path.join(INTERNAL_SKILLS_ROOT, skillId);
  const skillFile = path.join(skillDirectory, "SKILL.md");
  const content = await readFile(skillFile, "utf8").catch(() => null);
  if (!content) {
    return null;
  }

  return {
    directory: skillDirectory,
    parsed: parseSkillFrontmatter(content, skillFile),
  };
}

export async function listDashboardAgentSkills(): Promise<DashboardAgentSkillSummary[]> {
  const entries = await readdir(INTERNAL_SKILLS_ROOT, { withFileTypes: true }).catch(
    () => [],
  );
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const loaded = await readSkill(entry.name);
        if (!loaded) {
          return null;
        }

        return {
          id: entry.name,
          name: loaded.parsed.metadata.name,
          description: loaded.parsed.metadata.description,
          path: loaded.directory,
        } satisfies DashboardAgentSkillSummary;
      }),
  );

  return skills
    .filter((skill): skill is DashboardAgentSkillSummary => skill !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadDashboardAgentSkill(
  skillId: string,
): Promise<LoadSkillToolOutput | null> {
  const loaded = await readSkill(skillId);
  if (!loaded) {
    return null;
  }

  return {
    skill_id: skillId,
    skill_directory: loaded.directory,
    content: loaded.parsed.body,
  };
}

export async function loadDashboardAgentSkillReference(
  skillId: string,
  referenceName: string,
): Promise<LoadSkillReferenceToolOutput | null> {
  const loaded = await readSkill(skillId);
  if (!loaded) {
    return null;
  }

  const normalizedReferenceName = normalizeReferenceName(referenceName);
  if (!/^[a-z0-9-]+$/i.test(normalizedReferenceName)) {
    return null;
  }

  const referencePath = path.join(
    loaded.directory,
    "references",
    `${normalizedReferenceName}.md`,
  );
  const content = await readFile(referencePath, "utf8").catch(() => null);
  if (!content) {
    return null;
  }

  return {
    skill_id: skillId,
    reference_name: normalizedReferenceName,
    reference_path: referencePath,
    content: content.trim(),
  };
}
