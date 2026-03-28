import type { ToolSet } from "ai";
import type { AgentSkillDefinition } from "./types";

export function mergeSkillTools(skills: AgentSkillDefinition[]): ToolSet {
  const merged: ToolSet = {};

  for (const skill of skills) {
    const tools = skill.tools ?? {};

    for (const [toolName, toolDefinition] of Object.entries(tools)) {
      if (toolName in merged) {
        throw new Error(`Duplicate tool "${toolName}" registered by skill "${skill.id}".`);
      }

      merged[toolName] = toolDefinition;
    }
  }

  return merged;
}
