import type { ReactNode } from "react";

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-outline-variant bg-surface-container-lowest p-5">
      <h2 className="text-lg font-semibold text-on-surface">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
