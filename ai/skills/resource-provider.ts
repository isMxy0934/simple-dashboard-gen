import type { AgentSkillDefinition, AgentSkillResource } from "./types";

export function collectSkillResources(
  skills: AgentSkillDefinition[],
): AgentSkillResource[] {
  return skills.flatMap((skill) => skill.resources ?? []);
}

export function renderSkillResources(resources: AgentSkillResource[]): string {
  if (resources.length === 0) {
    return "";
  }

  return resources
    .flatMap((resource) => [`${resource.title}:`, resource.content, ""])
    .join("\n")
    .trim();
}
