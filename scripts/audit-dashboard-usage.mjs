import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

const root = process.cwd();
const outputPath = path.join(root, "docs/audit/dashboard-usage.md");
const databaseUrl = process.env.SDS_DATABASE_URL ?? process.env.DATABASE_URL;
const limits = {
  maxViews: Number(process.env.SDS_QUOTA_VIEWS_PER_DASHBOARD ?? 50),
  maxQueries: Number(process.env.SDS_QUOTA_QUERIES_PER_DASHBOARD ?? 100),
  maxDocumentBytes: Number(process.env.SDS_QUOTA_DOCUMENT_SIZE_MB ?? 2) * 1024 * 1024,
};

function rowStatus(row) {
  const maxViews = Number(row.max_views ?? 0);
  const maxQueries = Number(row.max_queries ?? 0);
  const maxBytes = Number(row.max_doc_bytes ?? 0);
  return maxViews > limits.maxViews ||
    maxQueries > limits.maxQueries ||
    maxBytes > limits.maxDocumentBytes
    ? "OVER_LIMIT"
    : "OK";
}

function tableRows(rows) {
  return [
    "| Scope | Dashboard count | Max views | Max queries | Max document bytes | Status |",
    "|---|---:|---:|---:|---:|---|",
    ...rows.map((row) => {
      const maxViews = Number(row.max_views ?? 0);
      const maxQueries = Number(row.max_queries ?? 0);
      const maxBytes = Number(row.max_doc_bytes ?? 0);
      return `| ${row.scope} | ${row.dashboard_count} | ${maxViews} | ${maxQueries} | ${maxBytes} | ${rowStatus(row)} |`;
    }),
  ].join("\n");
}

async function writeNotRunAudit() {
  await writeFile(
    outputPath,
    [
      "# Dashboard Usage Audit",
      "",
      "Status: NOT_RUN",
      "",
      "No `SDS_DATABASE_URL` or `DATABASE_URL` was configured when this audit ran.",
      "Run `SDS_DATABASE_URL=postgresql://... npm run audit:dashboard-usage` against staging before final release.",
      "",
    ].join("\n"),
    "utf8",
  );
}

await mkdir(path.dirname(outputPath), { recursive: true });

if (!databaseUrl) {
  await writeNotRunAudit();
  throw new Error("DATABASE_URL_REQUIRED_FOR_DASHBOARD_USAGE_AUDIT");
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const result = await client.query(`
    with documents as (
      select 'drafts' as scope, dashboard_document::jsonb as dashboard_document
      from workspace_dashboard_drafts
      union all
      select 'published' as scope, dashboard_document::jsonb as dashboard_document
      from workspace_dashboard_published
    ),
    usage as (
      select
        scope,
        dashboard_document,
        case
          when jsonb_typeof(dashboard_document->'dashboard_spec'->'views') = 'array'
          then jsonb_array_length(dashboard_document->'dashboard_spec'->'views')
          else 0
        end as view_count,
        case
          when jsonb_typeof(dashboard_document->'query_defs') = 'array'
          then jsonb_array_length(dashboard_document->'query_defs')
          else 0
        end as query_count
      from documents
    )
    select
      scope,
      count(*)::int as dashboard_count,
      coalesce(max(view_count), 0)::int as max_views,
      coalesce(max(query_count), 0)::int as max_queries,
      coalesce(max(octet_length(dashboard_document::text)), 0)::int as max_doc_bytes
    from usage
    group by scope
    order by scope asc
  `);

  const status = result.rows.some((row) => rowStatus(row) === "OVER_LIMIT")
    ? "OVER_LIMIT"
    : "OK";
  const body = [
    "# Dashboard Usage Audit",
    "",
    `Status: ${status}`,
    "",
    `Limits: views=${limits.maxViews}, queries=${limits.maxQueries}, document_bytes=${limits.maxDocumentBytes}`,
    "",
    tableRows(result.rows),
    "",
  ].join("\n");

  await writeFile(outputPath, body, "utf8");

  if (status === "OVER_LIMIT") {
    throw new Error("DASHBOARD_USAGE_OVER_DEFAULT_QUOTA");
  }
} finally {
  await client.end();
}
