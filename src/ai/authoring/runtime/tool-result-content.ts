import type { TextContent } from "@mariozechner/pi-ai";

const JSON_CONTEXT_TOOLS = new Set([
  "getViews",
  "getDatasources",
  "getView",
  "getQuery",
  "getBinding",
  "getDraftStatus",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "[unserializable tool result]";
  }
}

function textContent(text: string): TextContent[] {
  return [{ type: "text", text }];
}

function compactLine(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return `${label}: ${String(value)}`;
}

function joinLines(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function normalizedAffectedPath(path: string): string {
  return path
    .replaceAll("dashboard_spec", "dashboard")
    .replaceAll("query_defs", "queries")
    .replaceAll("bindings", "binding_specs");
}

function formatLoadSkillResult(output: unknown): string {
  if (!isRecord(output)) {
    return "Skill loaded.";
  }
  return joinLines([
    `Loaded skill: ${asString(output.skill_id) ?? "unknown"}`,
    compactLine("skill_directory", asString(output.skill_directory)),
    "",
    "<skill>",
    asString(output.content) ?? "",
    "</skill>",
  ]);
}

function formatRunCheckResult(output: unknown): string {
  if (!isRecord(output)) {
    return "Runtime check completed.";
  }

  const failures = Array.isArray(output.failures) ? output.failures : [];
  const failureLines = failures
    .filter(isRecord)
    .slice(0, 12)
    .map((failure) =>
      joinLines([
        `- ${asString(failure.code) ?? "failure"}: ${asString(failure.message) ?? ""}`,
        compactLine("  path", asString(failure.path)),
        compactLine("  view_id", asString(failure.view_id)),
        compactLine("  query_id", asString(failure.query_id)),
        compactLine("  binding_id", asString(failure.binding_id)),
      ]),
    );
  const checkViewIds = Array.isArray(output.checks)
    ? output.checks
        .filter(isRecord)
        .map((check) => asString(check.view_id))
        .filter((viewId): viewId is string => Boolean(viewId))
    : [];
  const rendererViewIds = Array.isArray(output.renderer_checks)
    ? output.renderer_checks
        .filter(isRecord)
        .map((check) => asString(check.view_id))
        .filter((viewId): viewId is string => Boolean(viewId))
    : [];
  const affectedViewIds = [...new Set([...checkViewIds, ...rendererViewIds])];

  return joinLines([
    "runCheck completed.",
    compactLine("status", asString(output.status)),
    compactLine("reason", asString(output.reason)),
    compactLine("check_count", Array.isArray(output.checks) ? output.checks.length : 0),
    compactLine("failure_count", failures.length),
    compactLine(
      "renderer_check_count",
      Array.isArray(output.renderer_checks) ? output.renderer_checks.length : 0,
    ),
    affectedViewIds.length ? `affected_view_ids: ${affectedViewIds.join(", ")}` : null,
    failureLines.length ? "failures:" : null,
    ...failureLines,
  ]);
}

function formatComposePatchResult(output: unknown): string {
  if (!isRecord(output) || !isRecord(output.suggestion)) {
    return "composePatch completed.";
  }

  const suggestion = output.suggestion;
  const approval = isRecord(output.approval) ? output.approval : {};
  const stabilization = isRecord(output.stabilization) ? output.stabilization : {};
  const runtimeCheck = isRecord(output.runtime_check) ? output.runtime_check : null;
  const patch = isRecord(suggestion.patch) ? suggestion.patch : {};
  const affectedPaths = asStringArray(approval.affected_paths).map(normalizedAffectedPath);
  const operationCount =
    asNumber(approval.operation_count) ??
    (Array.isArray(patch.operations) ? patch.operations.length : null);

  return joinLines([
    "composePatch completed.",
    compactLine("proposal_id", asString(suggestion.id)),
    compactLine("kind", asString(suggestion.kind)),
    compactLine("title", asString(suggestion.title)),
    compactLine("summary", asString(suggestion.summary)),
    compactLine("patch_summary", asString(patch.summary)),
    compactLine("operation_count", operationCount),
    affectedPaths.length ? `affected_paths: ${affectedPaths.join(", ")}` : null,
    compactLine("base_version", asNumber(output.base_version)),
    compactLine("draft_fingerprint", asString(output.draft_fingerprint)),
    compactLine("approval_status", asString(approval.status)),
    compactLine("approval_summary", asString(approval.summary)),
    compactLine("runtime_check_status", runtimeCheck ? asString(runtimeCheck.status) : null),
    compactLine("runtime_check_reason", runtimeCheck ? asString(runtimeCheck.reason) : null),
    compactLine("stabilization_status", asString(stabilization.status)),
    Array.isArray(stabilization.notes) && stabilization.notes.length
      ? `stabilization_notes: ${stabilization.notes
          .filter((note): note is string => typeof note === "string")
          .join("; ")}`
      : null,
  ]);
}

function formatApplyPatchResult(output: unknown): string {
  if (!isRecord(output)) {
    return "applyPatch completed.";
  }
  return joinLines([
    "applyPatch completed.",
    compactLine("applied", output.applied === true),
    compactLine("suggestion_id", asString(output.suggestion_id)),
    compactLine("kind", asString(output.kind)),
    compactLine("title", asString(output.title)),
    compactLine("summary", asString(output.summary)),
    compactLine("patch_summary", asString(output.patch_summary)),
    compactLine("focused_view_id", asString(output.focused_view_id)),
  ]);
}

function formatWriteToolResult(toolName: string, output: unknown): string {
  if (!isRecord(output)) {
    return `${toolName} completed.`;
  }

  const lines = [`${toolName} completed.`, compactLine("summary", asString(output.summary))];

  if (isRecord(output.view)) {
    lines.push(
      compactLine("view_id", asString(output.view.id)),
      compactLine("view_title", asString(output.view.title)),
      compactLine("renderer_kind", asString(output.view.renderer_kind)),
    );
  }
  if (isRecord(output.query)) {
    const query = isRecord(output.query.query) ? output.query.query : output.query;
    lines.push(
      compactLine("query_id", asString(query.id)),
      compactLine("query_name", asString(query.name)),
      compactLine("datasource_id", asString(query.datasource_id)),
    );
  }
  if (Array.isArray(output.bindings)) {
    lines.push(`binding_count: ${output.bindings.length}`);
    for (const bindingDetail of output.bindings.filter(isRecord).slice(0, 8)) {
      const binding = isRecord(bindingDetail.binding)
        ? bindingDetail.binding
        : bindingDetail;
      lines.push(
        `- binding ${asString(binding.id) ?? "unknown"}: view=${asString(binding.view_id) ?? "unknown"}, slot=${asString(binding.slot_id) ?? "unknown"}, mode=${asString(binding.mode) ?? "live"}, query=${asString(binding.query_id) ?? "none"}`,
      );
    }
  }
  lines.push(
    compactLine("view_id", asString(output.view_id)),
    compactLine("query_id", asString(output.query_id)),
    compactLine("binding_id", asString(output.binding_id)),
  );
  if (Array.isArray(output.removed_binding_ids)) {
    lines.push(`removed_binding_ids: ${output.removed_binding_ids.join(", ")}`);
  }
  if (isRecord(output.layout)) {
    lines.push(
      `layout: desktop=${output.layout.desktop ? "present" : "missing"}, mobile=${output.layout.mobile ? "present" : "missing"}`,
    );
  }

  return joinLines(lines);
}

function formatGoalResult(output: unknown): string {
  if (!isRecord(output)) {
    return "Authoring goal updated.";
  }
  return joinLines([
    "Authoring goal updated.",
    compactLine("accepted", output.accepted === true),
    compactLine("declared_intent_kind", asString(output.declaredIntentKind)),
    compactLine("active_goal_id", asString(output.activeGoalId)),
    compactLine("message", asString(output.message)),
  ]);
}

function formatKnownJsonResult(toolName: string, output: unknown): string {
  return `${toolName} result:\n${jsonText(output)}`;
}

function formatFallbackResult(toolName: string, output: unknown): string {
  if (typeof output === "string" && output.trim()) {
    return output;
  }
  if (isRecord(output) && asString(output.summary)) {
    return asString(output.summary) ?? "Tool completed.";
  }
  return `${toolName || "Tool"} completed.`;
}

export function formatAuthoringToolResultText(
  toolName: string,
  output: unknown,
): string {
  switch (toolName) {
    case "loadSkill":
      return formatLoadSkillResult(output);
    case "getSchemaByDatasource":
      return `Datasource schema loaded:\n${jsonText(output)}`;
    case "runCheck":
      return formatRunCheckResult(output);
    case "composePatch":
      return formatComposePatchResult(output);
    case "applyPatch":
      return formatApplyPatchResult(output);
    case "declareAuthoringGoal":
      return formatGoalResult(output);
    case "upsertView":
    case "upsertQuery":
    case "upsertBinding":
    case "upsertLayout":
    case "deleteView":
    case "deleteQuery":
    case "deleteBinding":
      return formatWriteToolResult(toolName, output);
    default:
      return JSON_CONTEXT_TOOLS.has(toolName)
        ? formatKnownJsonResult(toolName, output)
        : formatFallbackResult(toolName, output);
  }
}

export function formatAuthoringToolResultContent(
  toolName: string,
  output: unknown,
): TextContent[] {
  return textContent(formatAuthoringToolResultText(toolName, output));
}
