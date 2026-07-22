import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { MaterialIcon } from "../MaterialIcon.tsx";

export type MarkdownTableAlignment = "center" | "left" | "right";

export interface MarkdownTableData {
  alignments: MarkdownTableAlignment[];
  headers: string[];
  rows: string[][];
}

type SortDirection = "asc" | "desc";

interface SortState {
  columnIndex: number;
  direction: SortDirection;
}

type TableInlineRenderer = (content: string) => ReactNode;

const pageSizeOptions = [10, 25, 50] as const;

export function MarkdownTable({
  renderInline,
  table,
}: {
  renderInline: TableInlineRenderer;
  table: MarkdownTableData;
}) {
  return (
    <div className="truss-markdown-table-shell">
      <table className="truss-markdown-table">
        <TableHead alignments={table.alignments} headers={table.headers} renderInline={renderInline} />
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {normalizeRow(row, table.headers.length).map((cell, cellIndex) => (
                <td className={alignmentClass(table.alignments[cellIndex])} key={cellIndex}>
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SmartTable({
  renderInline,
  table,
  tableIndex,
}: {
  renderInline: TableInlineRenderer;
  table: MarkdownTableData;
  tableIndex: number;
}) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<boolean[]>(
    () => table.headers.map(() => true),
  );
  const [pageSize, setPageSize] = useState<number | "all">(10);
  const [pageIndex, setPageIndex] = useState(0);

  const visibleColumnIndexes = visibleColumns
    .map((visible, index) => (visible ? index : -1))
    .filter((index) => index >= 0);
  const sortedRows = useMemo(() => sortRows(table.rows, sort), [sort, table.rows]);
  const effectivePageSize = pageSize === "all" ? sortedRows.length || 1 : pageSize;
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / effectivePageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedRows =
    pageSize === "all"
      ? sortedRows
      : sortedRows.slice(
          safePageIndex * effectivePageSize,
          safePageIndex * effectivePageSize + effectivePageSize,
        );
  const visibleCount = visibleColumnIndexes.length;
  const canHideColumn = visibleCount > 1;

  function toggleSort(columnIndex: number): void {
    setSort((current) => {
      if (!current || current.columnIndex !== columnIndex) {
        return { columnIndex, direction: "asc" };
      }

      if (current.direction === "asc") {
        return { columnIndex, direction: "desc" };
      }

      return null;
    });
  }

  function toggleColumn(columnIndex: number): void {
    setVisibleColumns((current) => {
      if (current[columnIndex] && current.filter(Boolean).length <= 1) {
        return current;
      }

      return current.map((visible, index) => (index === columnIndex ? !visible : visible));
    });
  }

  function changePageSize(value: string): void {
    setPageSize(value === "all" ? "all" : Number(value));
    setPageIndex(0);
  }

  function downloadCsv(): void {
    const csv = tableToCsv(table, visibleColumnIndexes, sortedRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `truss-table-${tableIndex + 1}.csv`;
    anchor.rel = "noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="truss-smart-table" aria-label="Smart table">
      <div className="truss-smart-table-toolbar">
        <div className="truss-smart-table-title">
          <MaterialIcon name="table" size={18} />
          <span>{table.rows.length} rows</span>
          <span>{visibleCount} columns</span>
        </div>
        <div className="truss-smart-table-actions">
          <label className="truss-smart-table-select-label">
            Rows
            <select
              className="truss-smart-table-select"
              onChange={(event) => changePageSize(event.target.value)}
              value={pageSize}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value="all">All</option>
            </select>
          </label>
          <details className="truss-smart-table-columns">
            <summary aria-label="Choose visible columns" title="Choose visible columns">
              <MaterialIcon name="view_column" size={17} />
            </summary>
            <div className="truss-smart-table-column-menu">
              {table.headers.map((header, columnIndex) => (
                <label key={columnIndex}>
                  <input
                    checked={visibleColumns[columnIndex]}
                    disabled={!canHideColumn && visibleColumns[columnIndex]}
                    onChange={() => toggleColumn(columnIndex)}
                    type="checkbox"
                  />
                  <span>{header || `Column ${columnIndex + 1}`}</span>
                </label>
              ))}
            </div>
          </details>
          <button
            aria-label="Download table as CSV"
            className="truss-smart-table-action"
            onClick={downloadCsv}
            title="Download CSV"
            type="button"
          >
            <MaterialIcon name="download" size={17} />
          </button>
        </div>
      </div>

      <div className="truss-markdown-table-shell">
        <table className="truss-markdown-table truss-smart-table-grid">
          <thead>
            <tr>
              {visibleColumnIndexes.map((columnIndex) => {
                const direction =
                  sort?.columnIndex === columnIndex ? sort.direction : null;
                const header = table.headers[columnIndex] ?? "";
                const headerLabel = header || `Column ${columnIndex + 1}`;

                return (
                  <th
                    className={alignmentClass(table.alignments[columnIndex])}
                    key={columnIndex}
                    scope="col"
                  >
                    <div className="truss-smart-table-header">
                      <span className="truss-smart-table-header-label">
                        {header ? renderInline(header) : headerLabel}
                      </span>
                      <button
                        aria-label={`Sort by ${headerLabel}`}
                        className="truss-smart-table-sort"
                        onClick={() => toggleSort(columnIndex)}
                        type="button"
                      >
                        <MaterialIcon
                          name={
                            direction === "asc"
                              ? "arrow_upward"
                              : direction === "desc"
                                ? "arrow_downward"
                                : "unfold_more"
                          }
                          size={15}
                        />
                      </button>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row, rowIndex) => (
              <tr key={`${safePageIndex}:${rowIndex}`}>
                {visibleColumnIndexes.map((columnIndex) => (
                  <td
                    className={alignmentClass(table.alignments[columnIndex])}
                    key={columnIndex}
                  >
                    {renderInline(normalizeRow(row, table.headers.length)[columnIndex] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="truss-smart-table-footer">
        <span>
          Showing {pagedRows.length} of {sortedRows.length} rows
        </span>
        {pageSize === "all" ? null : (
          <div className="truss-smart-table-pager">
            <button
              aria-label="Previous table page"
              disabled={safePageIndex === 0}
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
              title="Previous page"
              type="button"
            >
              <MaterialIcon name="chevron_left" size={17} />
            </button>
            <span className="truss-smart-table-page-status">
              {safePageIndex + 1} / {pageCount}
            </span>
            <button
              aria-label="Next table page"
              disabled={safePageIndex >= pageCount - 1}
              onClick={() =>
                setPageIndex((current) => Math.min(pageCount - 1, current + 1))
              }
              title="Next page"
              type="button"
            >
              <MaterialIcon name="chevron_right" size={17} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function TableHead({
  alignments,
  headers,
  renderInline,
}: {
  alignments: MarkdownTableAlignment[];
  headers: string[];
  renderInline: TableInlineRenderer;
}) {
  return (
    <thead>
      <tr>
        {headers.map((header, index) => (
          <th className={alignmentClass(alignments[index])} key={index} scope="col">
            {header ? renderInline(header) : `Column ${index + 1}`}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function sortRows(rows: string[][], sort: SortState | null): string[][] {
  if (!sort) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    const leftValue = left[sort.columnIndex] ?? "";
    const rightValue = right[sort.columnIndex] ?? "";
    const comparison = compareCellValues(leftValue, rightValue);

    return sort.direction === "asc" ? comparison : -comparison;
  });
}

function compareCellValues(left: string, right: string): number {
  const leftNumber = Number(left.replace(/,/g, ""));
  const rightNumber = Number(right.replace(/,/g, ""));

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function tableToCsv(
  table: MarkdownTableData,
  visibleColumnIndexes: number[],
  rows: string[][],
): string {
  const csvRows = [
    visibleColumnIndexes.map((index) => table.headers[index] ?? ""),
    ...rows.map((row) =>
      visibleColumnIndexes.map((columnIndex) => row[columnIndex] ?? ""),
    ),
  ];

  return csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function normalizeRow(row: string[], cellCount: number): string[] {
  return Array.from({ length: cellCount }, (_value, index) => row[index] ?? "");
}

function alignmentClass(alignment: MarkdownTableAlignment | undefined): string {
  switch (alignment) {
    case "center":
      return "truss-table-align-center";
    case "right":
      return "truss-table-align-right";
    default:
      return "truss-table-align-left";
  }
}
