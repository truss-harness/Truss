import type { ReactNode } from "react";

export type DetailListItem = {
  emptyLabel?: string;
  label: string;
  value?: ReactNode;
};

export function DetailList({
  className = "",
  emptyLabel = "Not specified",
  items,
}: {
  className?: string;
  emptyLabel?: string;
  items: DetailListItem[];
}) {
  return (
    <dl className={["truss-detail-list", className].filter(Boolean).join(" ")}>
      {items.map((item) => {
        const empty = item.value === null || item.value === undefined || item.value === "";

        return (
          <div className="truss-detail-list-row" key={item.label}>
            <dt className="truss-detail-list-label">{item.label}</dt>
            <dd className={empty ? "truss-detail-list-value truss-detail-list-empty" : "truss-detail-list-value"}>
              {empty ? item.emptyLabel ?? emptyLabel : item.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
