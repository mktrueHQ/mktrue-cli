import { useTranslations } from "next-intl";

import type { ReactNode } from "react";

import { Container } from "./container";

/**
 * The shared shell for the pages that are read rather than scanned: privacy, terms, about.
 *
 * A narrower measure than the landing page's 1200px on purpose — running text wants roughly 65
 * characters a line, and a legal page set to the width of a marketing hero is a legal page nobody
 * finishes.
 */
export function ProsePage({
  title,
  intro,
  updated,
  children,
}: {
  readonly title: string;
  readonly intro: string;
  readonly updated?: string;
  readonly children: ReactNode;
}) {
  const t = useTranslations("Prose");

  return (
    <Container className="py-14 md:py-20">
      <div className="max-w-[68ch]">
        <h1 className="font-display text-title font-semibold text-balance">{title}</h1>
        <p className="mt-5 text-muted">{intro}</p>
        {updated !== undefined && (
          <p className="mt-4 font-mono text-meta text-muted">
            {t("lastUpdated")} {updated}
          </p>
        )}
        <div className="mt-12 flex flex-col gap-10">{children}</div>
      </div>
    </Container>
  );
}

export function ProseSection({
  heading,
  children,
}: {
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-lead font-medium">{heading}</h2>
      <div className="mt-3 flex flex-col gap-3 text-muted">{children}</div>
    </section>
  );
}

/** A list that reads as prose rather than as a feature grid. */
export function ProseList({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="flex list-none flex-col gap-2 p-0">
      {items.map((item) => (
        <li key={item} className="relative pl-5 text-muted">
          <span className="absolute top-[0.7em] left-0 size-1.5 rounded-full bg-control" />
          {item}
        </li>
      ))}
    </ul>
  );
}
