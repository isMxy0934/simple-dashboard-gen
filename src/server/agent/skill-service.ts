import { readFile } from "fs/promises";
import path from "path";
import type {
  DashboardAgentSkillSummary,
  LoadSkillToolOutput,
} from "@/agent/dashboard-agent/contracts/agent-contract";

const INTERNAL_SKILLS_ROOT = path.join(
  process.cwd(),
  "src",
  "agent",
  "dashboard-agent",
  "skills",
);
const INTERNAL_SKILL_IDS = [
  "echarts-kpi-text",
  "echarts-kpi-gauge",
  "echarts-line-timeseries",
  "echarts-bar-category",
] as const;

function extractSkillName(content: string, fallbackId: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : fallbackId;
}

function extractSkillDescription(content: string): string {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return lines[0] ?? "Internal dashboard authoring skill.";
}

export async function listInternalDashboardAgentSkills(): Promise<DashboardAgentSkillSummary[]> {
  const loadedSkills = await Promise.all(
    INTERNAL_SKILL_IDS.map(async (skillId) => {
      const skillDirectory = path.join(INTERNAL_SKILLS_ROOT, skillId);
      const skillFile = path.join(skillDirectory, "SKILL.md");
      const content = await readFile(skillFile, "utf8").catch(() => null);
      if (!content) {
        return null;
      }

      return {
        id: skillId,
        name: extractSkillName(content, skillId),
        description: extractSkillDescription(content),
        path: skillDirectory,
      } satisfies DashboardAgentSkillSummary;
    }),
  );
  const skills = loadedSkills.reduce<DashboardAgentSkillSummary[]>((acc, skill) => {
    if (skill) {
      acc.push(skill);
    }
    return acc;
  }, []);

  return skills.sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadInternalDashboardAgentSkill(
  skillName: string,
): Promise<LoadSkillToolOutput | null> {
  const skillDirectory = path.join(INTERNAL_SKILLS_ROOT, skillName);
  const skillFile = path.join(skillDirectory, "SKILL.md");
  const content = await readFile(skillFile, "utf8").catch(() => null);
  if (!content) {
    return null;
  }

  return {
    skill_id: skillName,
    skill_directory: skillDirectory,
    content,
  };
}
