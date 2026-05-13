import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const {
  normalizeMarkdownTableSource,
  readMarkdownTableBlock,
  splitMarkdownTableCells,
} = await import("../src/web/authoring/agent/markdown-table.ts");

test("readMarkdownTableBlock parses a standard markdown table", () => {
  const lines = [
    "| # | 图表 | 数据来源 | 说明 |",
    "|---|---|---|---|",
    "| 3 | GMV 周趋势 | sales_weekly_fact | 整体 GMV 按周走势 |",
    "| 4 | 各渠道转化率趋势 | sales_quality | 按 channel 分线的转化率变化 |",
    "",
  ];

  const block = readMarkdownTableBlock(lines, 0);

  assert.ok(block);
  assert.deepEqual(block.table.headers, ["#", "图表", "数据来源", "说明"]);
  assert.equal(block.table.rows.length, 2);
  assert.equal(block.nextIndex, 4);
});

test("normalizeMarkdownTableSource recovers collapsed table rows", () => {
  const source =
    "| # | 图表 | 数据来源 | 说明 | |---|---|---|---| | 3 | GMV 周趋势 | sales_weekly_fact | 整体 GMV 按周走势 | | 4 | 各渠道转化率趋势 | sales_quality | 按 channel 分线的转化率变化 |";

  const lines = normalizeMarkdownTableSource(source).split("\n");
  const block = readMarkdownTableBlock(lines, 0);

  assert.deepEqual(lines, [
    "| # | 图表 | 数据来源 | 说明 |",
    "|---|---|---|---|",
    "| 3 | GMV 周趋势 | sales_weekly_fact | 整体 GMV 按周走势 |",
    "| 4 | 各渠道转化率趋势 | sales_quality | 按 channel 分线的转化率变化 |",
  ]);
  assert.ok(block);
  assert.equal(block.table.rows[1]?.[1], "各渠道转化率趋势");
});

test("splitMarkdownTableCells rejects non-table paragraphs", () => {
  assert.equal(splitMarkdownTableCells("第二层：趋势分析（2 张折线图）"), null);
});
