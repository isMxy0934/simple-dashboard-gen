import type { ToolSet } from "ai";

export interface AgentSkillResource {
  id: string;
  title: string;
  content: string;
}

export interface AgentSkillApprovalPolicy {
  requiresApproval: boolean;
  summary?: string;
}

export interface AgentSkillDefinition<TTools extends ToolSet = ToolSet> {
  id: string;
  description: string;
  instructions: string[];
  resources?: AgentSkillResource[];
  tools?: TTools;
  approvalPolicy?: AgentSkillApprovalPolicy;
}
