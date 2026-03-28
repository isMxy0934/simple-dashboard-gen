import type {
  AgentDraftOutput,
  ApplyPatchToolOutput,
  AuthoringWorkflowSummary,
  AuthoringAgentMessage,
} from "./agent-contract";
import type { AuthoringRouteDecision } from "./authoring-route";

export function findLatestDraftOutput(
  messages: AuthoringAgentMessage[],
): AgentDraftOutput | null {
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
        return part.output as AgentDraftOutput;
      }
    }
  }

  return null;
}

export function findDraftOutputBySuggestionId(
  messages: AuthoringAgentMessage[],
  suggestionId: string,
): AgentDraftOutput | null {
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
        const output = part.output as AgentDraftOutput;
        if (output.suggestion.id === suggestionId) {
          return output;
        }
      }
    }
  }

  return null;
}

export function findLatestApplyPatchApproval(messages: AuthoringAgentMessage[]): {
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

export function hasPendingToolApproval(messages: AuthoringAgentMessage[]) {
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
  messages: AuthoringAgentMessage[],
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

export function findLatestAuthoringRoute(
  messages: AuthoringAgentMessage[],
): AuthoringRouteDecision | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type === "data-authoring_route") {
        return part.data as AuthoringRouteDecision;
      }
    }
  }

  return null;
}

export function findLatestAuthoringWorkflow(
  messages: AuthoringAgentMessage[],
): AuthoringWorkflowSummary | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type === "data-authoring_workflow") {
        return part.data as AuthoringWorkflowSummary;
      }
    }
  }

  return null;
}
