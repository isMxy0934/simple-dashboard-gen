export interface ParsedMarkdownTable {
  headers: string[];
  rows: string[][];
}

export interface ParsedMarkdownTableBlock {
  table: ParsedMarkdownTable;
  nextIndex: number;
}

const COLLAPSED_TABLE_SEPARATOR_BOUNDARY = /\|\s+\|\s*:?-{3,}:?\s*\|/;
const COLLAPSED_TABLE_ROW_BOUNDARY =
  /\|\s+\|(?=\s*(?:[:\-]{3,}:?\s*\||[^|\n]{1,100}\s*\|))/g;
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/;

export function normalizeMarkdownTableSource(source: string): string {
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      if (!COLLAPSED_TABLE_SEPARATOR_BOUNDARY.test(line)) {
        return line;
      }
      return line.replace(COLLAPSED_TABLE_ROW_BOUNDARY, "|\n|");
    })
    .join("\n");
}

export function splitMarkdownTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return null;
  }
  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

export function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableCells(line);
  return Boolean(
    cells &&
      cells.length >= 2 &&
      cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell)),
  );
}

export function readMarkdownTableBlock(
  lines: readonly string[],
  startIndex: number,
): ParsedMarkdownTableBlock | null {
  const headers = splitMarkdownTableCells(lines[startIndex] ?? "");
  if (!headers || isMarkdownTableSeparator(lines[startIndex] ?? "")) {
    return null;
  }
  if (!isMarkdownTableSeparator(lines[startIndex + 1] ?? "")) {
    return null;
  }

  const rows: string[][] = [];
  let index = startIndex + 2;
  while (index < lines.length) {
    const cells = splitMarkdownTableCells(lines[index] ?? "");
    if (!cells || isMarkdownTableSeparator(lines[index] ?? "")) {
      break;
    }
    rows.push(cells);
    index += 1;
  }

  return {
    table: { headers, rows },
    nextIndex: index,
  };
}
