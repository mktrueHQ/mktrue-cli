import type { ReactNode } from "react";

/**
 * The page's one width decision, in one place.
 *
 * **Why this exists.** Every section used to repeat `mx-auto max-w-[1200px] px-4 md:px-14` — and
 * one of them (the MCP band) didn't, so on an ultrawide display it stretched to the full viewport
 * while everything above and below it stayed at 1200px. A shared measure cannot drift out of sync
 * with itself.
 *
 * **Full-bleed backgrounds, constrained content.** A section that wants an edge-to-edge background
 * (a border band, a tinted stripe) puts that on the `<section>` and wraps its children in this.
 * The alternative — constraining the section itself — leaves the background stopping at 1200px,
 * which is the thing that reads as broken on a wide screen.
 */
export function Container({
  children,
  className = "",
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1200px] px-5 md:px-14 ${className}`}>{children}</div>
  );
}
