import { readFile } from "fs/promises";
import path from "path";
import type { Skill } from "@mariozechner/pi-coding-agent";
import type {
  AuthoringSkillSummary,
  LoadSkillToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import {
  availableSemanticSkillIdsForTemplate,
} from "@/ai/authoring/template-runtime/authoring-surface";
import { ECHARTS_STAGE_CHART_RECIPE_IDS } from "@/contracts/dashboard-chart-recipes";
import {
  resolveCompatibleTemplateCapabilityId,
} from "@/contracts/dashboard-template-capability-registry";

const INTERNAL_SKILLS_ROOT = path.join(
  process.cwd(),
  "src",
  "ai",
  "authoring",
  "skills",
);

const SEMANTIC_AUTHORING_SKILL_IDS = [
  "stat-kpi",
  "time-trend",
  "category-comparison",
  "ranked-bar",
  "signal-list",
  "funnel",
  "bounded-gauge",
] as const;

const SEMANTIC_AUTHORING_SKILL_ID_SET = new Set<string>(
  SEMANTIC_AUTHORING_SKILL_IDS,
);
const RENDERER_RECIPE_SKILL_ID_SET = new Set<string>(
  ECHARTS_STAGE_CHART_RECIPE_IDS,
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

function isSemanticAuthoringSkillId(skillName: string): boolean {
  return SEMANTIC_AUTHORING_SKILL_ID_SET.has(skillName);
}

function isRendererRecipeSkillId(skillName: string): boolean {
  return RENDERER_RECIPE_SKILL_ID_SET.has(skillName);
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

function filterAuthoringSkillsForTemplateScope(input: {
  skills: AuthoringSkillSummary[];
  templateOrDesignKitId?: string | null;
}): AuthoringSkillSummary[] {
  const compatibleTemplateId = input.templateOrDesignKitId
    ? resolveCompatibleTemplateCapabilityId(input.templateOrDesignKitId)
    : null;
  if (!compatibleTemplateId) {
    return [];
  }
  const runtimeSkillCatalog = new Map(
    input.skills.map((skill) => [skill.id, skill]),
  );
  const visibleSkillIds = new Set(
    availableSemanticSkillIdsForTemplate({
      templateId: compatibleTemplateId,
      runtimeSkillCatalog,
    }),
  );
  return input.skills.filter((skill) => visibleSkillIds.has(skill.id));
}

export async function listAuthoringSkills(input?: {
  templateId?: string | null;
  designKitId?: string | null;
}): Promise<AuthoringSkillSummary[]> {
  const skills = (await loadInternalSkills())
    .filter((skill) => isSemanticAuthoringSkillId(skillId(skill)))
    .map(toSummary);
  const templateOrDesignKitId =
    input?.templateId?.trim() || input?.designKitId?.trim() || null;
  if (!templateOrDesignKitId) {
    return skills;
  }
  return filterAuthoringSkillsForTemplateScope({
    skills,
    templateOrDesignKitId,
  });
}

export function filterAuthoringSkillsForTemplate(
  skills: AuthoringSkillSummary[],
  templateId: string,
): AuthoringSkillSummary[] {
  return filterAuthoringSkillsForTemplateScope({
    skills,
    templateOrDesignKitId: templateId,
  });
}

export function filterAuthoringSkillsForDesignKit(
  skills: AuthoringSkillSummary[],
  designKitId: string,
): AuthoringSkillSummary[] {
  return filterAuthoringSkillsForTemplate(skills, designKitId);
}

export async function loadAuthoringSkill(
  skillName: string,
): Promise<LoadSkillToolOutput | null> {
  const normalized = skillName.trim();
  if (isRendererRecipeSkillId(normalized)) {
    return null;
  }
  const skill = (await loadInternalSkills()).find(
    (entry) =>
      isSemanticAuthoringSkillId(skillId(entry)) &&
      (skillId(entry) === normalized || entry.name === normalized),
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
