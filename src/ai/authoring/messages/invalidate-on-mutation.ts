import type { AuthoringMessage } from "@/ai/authoring/types";

export type MutationDescriptor =
  | { kind: "view"; view_id: string }
  | { kind: "query"; query_id: string; affected_view_ids: string[] }
  | { kind: "binding"; binding_id: string; view_id: string }
  | { kind: "view-delete"; view_id: string }
  | { kind: "query-delete"; query_id: string; affected_view_ids: string[] }
  | { kind: "binding-delete"; binding_id: string; view_id: string }
  | { kind: "patch-apply" };

function cloneMessages(messages: AuthoringMessage[]): AuthoringMessage[] {
  return JSON.parse(JSON.stringify(messages)) as AuthoringMessage[];
}

function shouldInvalidatePart(
  part: AuthoringMessage["parts"][number],
  mutation: MutationDescriptor,
): boolean {
  const toolPart = part as AuthoringMessage["parts"][number] & {
    input?: unknown;
  };
  if (!part.type.startsWith("tool-get") && part.type !== "tool-runCheck") {
    return false;
  }

  if (mutation.kind === "patch-apply") {
    return true;
  }

  const input = (toolPart.input ?? {}) as Record<string, unknown>;

  switch (mutation.kind) {
    case "view":
    case "view-delete":
      return input.view_id === mutation.view_id;
    case "query":
    case "query-delete":
      return input.query_id === mutation.query_id || mutation.affected_view_ids.includes(String(input.view_id ?? ""));
    case "binding":
    case "binding-delete":
      return input.binding_id === mutation.binding_id || input.view_id === mutation.view_id;
    default:
      return false;
  }
}

export function invalidateMutatedReads(
  messages: AuthoringMessage[],
  mutation: MutationDescriptor,
): AuthoringMessage[] {
  const next = cloneMessages(messages);

  for (const message of next) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      const toolPart = part as AuthoringMessage["parts"][number] & {
        state?: string;
        output?: unknown;
      };
      if (
        part.type.startsWith("tool-") &&
        toolPart.state === "output-available" &&
        shouldInvalidatePart(part, mutation)
      ) {
        toolPart.output = {
          _stale_after_mutation: true,
          mutation: mutation.kind,
        };
      }
    }
  }

  return next;
}
