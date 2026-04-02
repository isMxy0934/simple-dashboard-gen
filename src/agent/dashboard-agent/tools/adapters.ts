export function summarizeAgentToolResult(output: unknown) {
  if (!output || typeof output !== "object") {
    return output;
  }

  const record = output as Record<string, unknown>;
  const suggestion = record.suggestion as Record<string, unknown> | undefined;
  const runtimeCheck = record.runtime_check as Record<string, unknown> | undefined;

  if ("dashboard_name" in record && "views" in record) {
    return {
      views: {
        dashboard_name: record.dashboard_name,
        dashboard_id: record.dashboard_id,
        view_count: record.view_count,
        views: record.views,
      },
    };
  }

  if ("datasource_count" in record && "datasources" in record) {
    return {
      datasources: {
        datasource_count: record.datasource_count,
        datasources: record.datasources,
      },
    };
  }

  if ("match_status" in record) {
    return {
      view: {
        match_status: record.match_status,
        view_id:
          (record.view as Record<string, unknown> | undefined)?.view &&
          typeof (
            ((record.view as Record<string, unknown>).view as Record<string, unknown>)
              .id
          ) === "string"
            ? ((record.view as Record<string, unknown>).view as Record<string, unknown>)
                .id
            : undefined,
        matches: record.matches,
      },
    };
  }

  if ("query" in record && "used_by" in record) {
    const query = record.query as Record<string, unknown>;
    return {
      query: {
        id: query.id,
        name: query.name,
        used_by_count: Array.isArray(record.used_by) ? record.used_by.length : 0,
      },
    };
  }

  if ("bindings" in record && Array.isArray(record.bindings)) {
    return {
      bindings: {
        count: record.bindings.length,
      },
    };
  }

  if ("datasource_id" in record && "tables" in record) {
    return {
      datasource_schema: {
        datasource_id: record.datasource_id,
        dialect: record.dialect,
        table_count: Array.isArray(record.tables) ? record.tables.length : 0,
        metric_count: Array.isArray(record.metrics) ? record.metrics.length : 0,
      },
    };
  }

  if ("checks" in record && Array.isArray(record.checks)) {
    return {
      run_check: {
        status: record.status,
        reason: record.reason,
        check_count: record.checks.length,
      },
    };
  }

  if ("view" in record && "summary" in record) {
    return {
      upsert_view: {
        summary: record.summary,
      },
    };
  }

  if ("query" in record && "summary" in record) {
    return {
      upsert_query: {
        summary: record.summary,
      },
    };
  }

  if ("applied" in record && "suggestion_id" in record) {
    return {
      apply_patch: {
        suggestion_id: record.suggestion_id,
        title: record.title,
        summary: record.summary,
        patch_summary: record.patch_summary,
      },
    };
  }

  return {
    suggestion: suggestion
      ? {
          kind: suggestion.kind,
          title: suggestion.title,
          summary: suggestion.summary,
          patchSummary:
            typeof (suggestion.patch as Record<string, unknown> | undefined)?.summary ===
            "string"
              ? (suggestion.patch as Record<string, unknown>).summary
              : undefined,
          patchOperations:
            Array.isArray(
              (suggestion.patch as Record<string, unknown> | undefined)?.operations,
            )
              ? (
                  (suggestion.patch as Record<string, unknown>).operations as Array<
                    Record<string, unknown>
                  >
                )
                  .slice(0, 8)
                  .map((operation) => ({
                    op: operation.op,
                    path: operation.path,
                    summary: operation.summary,
                  }))
              : [],
        }
      : undefined,
    approval: record.approval,
    runtime_check: runtimeCheck,
    repair: record.repair,
  };
}
