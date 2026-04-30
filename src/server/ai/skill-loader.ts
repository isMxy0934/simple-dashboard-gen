import { readFile } from "fs/promises";
import path from "path";
import type { Skill } from "@mariozechner/pi-coding-agent";
import type {
  AuthoringSkillSummary,
  LoadSkillToolOutput,
} from "@/ai/authoring/contracts/tool-io";

const INTERNAL_SKILLS_ROOT = path.join(
  process.cwd(),
  "src",
  "ai",
  "authoring",
  "skills",
);

async function loadPiSkillsApi(): Promise<
  Pick<
    typeof import("@mariozechner/pi-coding-agent"),
    "loadSkillsFromDir" | "stripFrontmatter"
  >
> {
  const dynamicImport = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<typeof import("@mariozechner/pi-coding-agent")>;
  const mod = await dynamicImport("@mariozechner/pi-coding-agent");
  return {
    loadSkillsFromDir: mod.loadSkillsFromDir,
    stripFrontmatter: mod.stripFrontmatter,
  };
}

function skillId(skill: Skill): string {
  return path.basename(skill.baseDir);
}

function toSummary(skill: Skill): AuthoringSkillSummary {
  return {
    id: skillId(skill),
    name: skill.name,
    description: skill.description,
    path: skill.baseDir,
  };
}

async function loadInternalSkills(): Promise<Skill[]> {
  const { loadSkillsFromDir } = await loadPiSkillsApi();
  const result = loadSkillsFromDir({
    dir: INTERNAL_SKILLS_ROOT,
    source: "simple-dashboard-gen",
  });

  return result.skills.sort((left, right) =>
    skillId(left).localeCompare(skillId(right)),
  );
}

export async function listAuthoringSkills(): Promise<AuthoringSkillSummary[]> {
  return (await loadInternalSkills()).map(toSummary);
}

export async function loadAuthoringSkill(
  skillName: string,
): Promise<LoadSkillToolOutput | null> {
  const normalized = skillName.trim();
  const skill = (await loadInternalSkills()).find(
    (entry) => skillId(entry) === normalized || entry.name === normalized,
  );
  if (!skill) {
    return null;
  }

  const content = await readFile(skill.filePath, "utf8");
  const { stripFrontmatter } = await loadPiSkillsApi();

  return {
    skill_id: skillId(skill),
    skill_directory: skill.baseDir,
    content: stripFrontmatter(content).trim(),
  };
}
