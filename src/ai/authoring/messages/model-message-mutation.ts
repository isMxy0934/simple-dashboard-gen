import type { ModelMessage, ToolResultPart } from "@ai-sdk/provider-utils";
import type { MutationDescriptor } from "@/ai/authoring/messages/invalidate-on-mutation";

const STALE_AFTER_MUTATION_TOOL_NAMES = new Set([
  "getViews",
  "getDatasources",
  "getView",
  "getQuery",
  "getBinding",
  "getSchemaByDatasource",
  "runCheck",
  "loadSkill",
  "composePatch",
]);

function cloneMessages(messages: ModelMessage[]): ModelMessage[] {
  return JSON.parse(JSON.stringify(messages)) as ModelMessage[];
}

function markToolResultStale(
  part: ToolResultPart,
  mutationKinds: MutationDescriptor["kind"][],
): ToolResultPart {
  if (part.output.type !== "json" || typeof part.output.value !== "object" || part.output.value === null) {
    return part;
  }

  return {
    ...part,
    output: {
      ...part.output,
      value: {
        ...(part.output.value as Record<string, unknown>),
        _stale_after_mutation: true,
        mutation_kinds: mutationKinds,
      },
    },
  };
}

export function invalidateMutatedModelMessages(
  messages: ModelMessage[],
  mutations: MutationDescriptor[],
): ModelMessage[] {
  if (mutations.length === 0) {
    return messages;
  }

  const mutationKinds = [...new Set(mutations.map((mutation) => mutation.kind))];
  const next = cloneMessages(messages);

  for (let messageIndex = 0; messageIndex < next.length; messageIndex += 1) {
    const message = next[messageIndex];
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      continue;
    }

    next[messageIndex] = {
      ...message,
      content: message.content.map((part) => {
        if (
          part.type !== "tool-result" ||
          !STALE_AFTER_MUTATION_TOOL_NAMES.has(part.toolName)
        ) {
          return part;
        }

        return markToolResultStale(part, mutationKinds);
      }),
    };
  }

  return next;
}
