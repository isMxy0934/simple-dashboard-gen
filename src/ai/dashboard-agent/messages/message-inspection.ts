import type {
  DashboardAgentDraftOutput,
  ApplyPatchToolOutput,
  DashboardAgentWorkflowSummary,
  DashboardAgentMessage,
} from "@/ai/dashboard-agent/contracts/agent-contract";
import type { DashboardAgentRouteDecision } from "@/ai/dashboard-agent/contracts/route";

export function findLatestDraftOutput(
  messages: DashboardAgentMessage[],
): DashboardAgentDraftOutput | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type === "tool-composePatch" &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object" &&
        "suggestion" in part.output
      ) {
        return part.output as DashboardAgentDraftOutput;
      }
    }
  }

  return null;
}

export function findDraftOutputBySuggestionId(
  messages: DashboardAgentMessage[],
  suggestionId: string,
): DashboardAgentDraftOutput | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type === "tool-composePatch" &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object" &&
        "suggestion" in part.output
      ) {
        const output = part.output as DashboardAgentDraftOutput;
        if (output.suggestion.id === suggestionId) {
          return output;
        }
      }
    }
  }

  return null;
}

export function findLatestApplyPatchApproval(messages: DashboardAgentMessage[]): {
  approvalId: string;
  suggestionId: string | null;
} | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type === "tool-applyPatch" &&
        part.state === "approval-requested"
      ) {
        return {
          approvalId: part.approval.id,
          suggestionId:
            part.input &&
            typeof part.input === "object" &&
            "suggestion_id" in part.input &&
            typeof part.input.suggestion_id === "string"
              ? part.input.suggestion_id
              : null,
        };
      }
    }
  }

  return null;
}

export function hasPendingToolApproval(messages: DashboardAgentMessage[]) {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type.startsWith("tool-") &&
        "state" in part &&
        part.state === "approval-requested"
      ) {
        return true;
      }
    }
  }

  return false;
}

export function findLatestApplyPatchOutput(
  messages: DashboardAgentMessage[],
): ApplyPatchToolOutput | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    for (const part of [...message.parts].reverse()) {
      if (
        part.type === "tool-applyPatch" &&
        part.state === "output-available" &&
        part.output &&
        typeof part.output === "object" &&
        "suggestion_id" in part.output
      ) {
        return part.output as ApplyPatchToolOutput;
      }
    }
  }

  return null;
}

export function findLatestDashboardAgentRoute(
  messages: DashboardAgentMessage[],
): DashboardAgentRouteDecision | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type === "data-dashboard_agent_route") {
        return part.data as DashboardAgentRouteDecision;
      }
    }
  }

  return null;
}

export function findLatestWorkflow(
  messages: DashboardAgentMessage[],
): DashboardAgentWorkflowSummary | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type === "data-dashboard_agent_workflow") {
        return part.data as DashboardAgentWorkflowSummary;
      }
    }
  }

  return null;
}
