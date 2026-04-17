import type { AuthoringMessage } from "@/ai/authoring/types";

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
  switch (part.type) {
    case "tool-getView":
      return {
        _superseded_by_later_read: true,
        view_id:
          (part.output as { view?: { view?: { id?: string } } })?.view?.view?.id ??
          (part.input as { view_id?: string })?.view_id ??
          null,
      };
    case "tool-getQuery":
      return {
        _superseded_by_later_read: true,
        query_id: (part.input as { query_id?: string })?.query_id ?? null,
      };
    case "tool-getBinding":
      return {
        _superseded_by_later_read: true,
        view_id: (part.input as { view_id?: string })?.view_id ?? null,
        slot_id: (part.input as { slot_id?: string })?.slot_id ?? null,
      };
    case "tool-getSchemaByDatasource":
      return {
        _superseded_by_later_read: true,
        datasource_id: (part.input as { datasource_id?: string })?.datasource_id ?? null,
      };
    case "tool-runCheck":
      return {
        _superseded_by_later_read: true,
        scope: (part.input as { scope?: string })?.scope ?? null,
        view_id: (part.input as { view_id?: string })?.view_id ?? null,
        status: (part.output as { status?: string })?.status ?? null,
      };
    case "tool-loadSkill":
      return { _superseded_by_later_read: true };
    case "tool-loadSkillReference":
      return { _superseded_by_later_read: true };
    case "tool-composePatch": {
      const output = part.output as { suggestion?: { id?: string; summary?: string } };
      return {
        suggestion: {
          id: output?.suggestion?.id ?? null,
          summary: output?.suggestion?.summary ?? "",
        },
        _superseded_by_later_read: true,
      };
    }
    case "tool-applyPatch": {
      const output = part.output as Record<string, unknown>;
      return { ...output, dashboard: undefined };
    }
    default:
      return { _superseded_by_later_read: true };
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

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      const toolPart = part as AuthoringMessage["parts"][number] & {
        state?: string;
        output?: unknown;
      };

      if (part.type === "tool-applyPatch" && toolPart.state === "output-available") {
        toolPart.output = buildPlaceholder(part);
        continue;
      }

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
