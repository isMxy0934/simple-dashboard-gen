import type { DatasourceListItemSummary } from "./contracts/tool-io";

const DATA_CONTEXT_TERMS = [
  "sql",
  "athena",
  "postgres",
  "table",
  " 表",
  "表 ",
  "schema",
  "字段",
  "数据源",
  "用这个",
  "就用",
  "使用",
];

export function hasConfirmedDataContext(input: {
  latestUserText: string;
  datasources: DatasourceListItemSummary[];
}): boolean {
  const lowered = input.latestUserText.trim().toLowerCase();
  if (!lowered) {
    return false;
  }

  if (DATA_CONTEXT_TERMS.some((term) => lowered.includes(term))) {
    return true;
  }

  if (/\b(public|dbo|analytics|sales|mart|ods|dwd|dws|ads)\.[a-zA-Z_][\w$]*\b/.test(lowered)) {
    return true;
  }

  const normalizedText = lowered.replace(/[-_\s]/g, "");
  return input.datasources.some((datasource) => {
    const label = datasource.label.toLowerCase();
    const id = datasource.datasource_id.toLowerCase();
    const normalizedLabel = label.replace(/[-_\s]/g, "");
    const normalizedId = id.replace(/[-_\s]/g, "");
    return (
      lowered.includes(label) ||
      lowered.includes(id) ||
      normalizedText.includes(normalizedLabel) ||
      normalizedText.includes(normalizedId)
    );
  });
}
