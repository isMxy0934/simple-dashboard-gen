import type { AuthoringMessage } from "@/ai/authoring/contracts/runtime";

function cloneMessages(messages: AuthoringMessage[]): AuthoringMessage[] {
  return JSON.parse(JSON.stringify(messages)) as AuthoringMessage[];
}

function singletonKey(partType: string) {
  return `${partType}:singleton`;
}

function resolveRedactionKey(part: AuthoringMessage["parts"][number]): string | null {
  const toolPart = part as AuthoringMessage["parts"][number] & {
    state?: string;
    input?: unknown;
    output?: unknown;
  };

  if (!part.type.startsWith("tool-") || toolPart.state !== "output-available") {
    return null;
  }

  switch (part.type) {
    case "tool-getView":
      return `${part.type}:${String((toolPart.input as { view_id?: string })?.view_id ?? (toolPart.output as { view?: { view?: { id?: string } } })?.view?.view?.id ?? "")}`;
    case "tool-getQuery":
      return `${part.type}:${String((toolPart.input as { query_id?: string })?.query_id ?? "")}`;
    case "tool-getBinding":
      return `${part.type}:${String((toolPart.input as { view_id?: string; slot_id?: string })?.view_id ?? "")}:${String((toolPart.input as { slot_id?: string })?.slot_id ?? "*")}`;
    case "tool-getSchemaByDatasource":
      return `${part.type}:${String((toolPart.input as { datasource_id?: string })?.datasource_id ?? "")}`;
    case "tool-runCheck":
      return `${part.type}:${String((toolPart.input as { scope?: string; view_id?: string })?.scope ?? "")}:${String((toolPart.input as { view_id?: string })?.view_id ?? "*")}`;
    case "tool-loadSkill":
      return `${part.type}:${String((toolPart.input as { name?: string })?.name ?? "")}`;
    case "tool-loadSkillReference":
      return `${part.type}:${String((toolPart.input as { skill_id?: string; reference_name?: string })?.skill_id ?? "")}:${String((toolPart.input as { reference_name?: string })?.reference_name ?? "")}`;
    case "tool-getViews":
    case "tool-getDatasources":
    case "tool-composePatch":
      return singletonKey(part.type);
    default:
      return null;
  }
}

function buildPlaceholder(part: AuthoringMessage["parts"][number]) {
  const toolPart = part as AuthoringMessage["parts"][number] & {
    input?: unknown;
    output?: unknown;
  };
  const output =
    toolPart.output && typeof toolPart.output === "object"
      ? { ...(toolPart.output as Record<string, unknown>) }
      : { value: toolPart.output ?? null };

  switch (part.type) {
    case "tool-getView":
      return {
        ...output,
        _superseded_by_later_read: true,
        view_id:
          (toolPart.output as { view?: { view?: { id?: string } } })?.view?.view?.id ??
          (toolPart.input as { view_id?: string })?.view_id ??
          null,
      };
    case "tool-getQuery":
      return {
        ...output,
        _superseded_by_later_read: true,
        query_id: (toolPart.input as { query_id?: string })?.query_id ?? null,
      };
    case "tool-getBinding":
      return {
        ...output,
        _superseded_by_later_read: true,
        view_id: (toolPart.input as { view_id?: string })?.view_id ?? null,
        slot_id: (toolPart.input as { slot_id?: string })?.slot_id ?? null,
      };
    case "tool-getSchemaByDatasource":
      return {
        ...output,
        _superseded_by_later_read: true,
        datasource_id: (toolPart.input as { datasource_id?: string })?.datasource_id ?? null,
      };
    case "tool-runCheck":
      return {
        ...output,
        _superseded_by_later_read: true,
        scope: (toolPart.input as { scope?: string })?.scope ?? null,
        view_id: (toolPart.input as { view_id?: string })?.view_id ?? null,
        status: (toolPart.output as { status?: string })?.status ?? null,
      };
    case "tool-loadSkill":
      return { ...output, _superseded_by_later_read: true };
    case "tool-loadSkillReference":
      return { ...output, _superseded_by_later_read: true };
    case "tool-composePatch": {
      return {
        ...output,
        _superseded_by_later_read: true,
      };
    }
    default:
      return { ...output, _superseded_by_later_read: true };
  }
}

export function redactSupersededToolOutputs(
  messages: AuthoringMessage[],
): AuthoringMessage[] {
  const next = cloneMessages(messages);
  const seen = new Set<string>();

  for (let messageIndex = next.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = next[messageIndex];
    if (message.role !== "assistant") {
      continue;
    }

    const parts = Array.isArray(message.parts) ? message.parts : [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      const toolPart = part as AuthoringMessage["parts"][number] & {
        state?: string;
        output?: unknown;
      };

      const key = resolveRedactionKey(part);
      if (!key) {
        continue;
      }

      if (seen.has(key)) {
        toolPart.output = buildPlaceholder(part);
        continue;
      }

      seen.add(key);
    }
  }

  return next;
}
