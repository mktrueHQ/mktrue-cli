import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";

/**
 * The page's two calls to action, and they are not equals.
 *
 * - `solid` — "Request access". The one thing this page asks of the reader it is written for, so
 *   it is the one thing that gets the accent.
 * - `quiet` — "Go to the app", in the header. For those already invited. As the solid one it sent
 *   everyone else to a sign-in card that says sign-ups are disabled.
 *
 * **It used to be three.** "View the source" is gone: __MKTRUE_TITLE__ is not being open-sourced, so the CTA
 * pointed at nothing a reader could ever reach. A link that cannot be honoured is worse
 * than an absent one on a page whose whole argument is that it does not overclaim.
 *
 * 48px tall, a daily-control size rather than the 44px minimum. `quiet` keeps the size's padding,
 * so it gives up the fill and keeps the target.
 */
export function Cta({
  href,
  variant,
  children,
  className = "",
  size = "md",
}: {
  readonly href: string;
  readonly variant: "solid" | "quiet";
  readonly children: ReactNode;
  readonly className?: string;
  readonly size?: "md" | "lg";
}) {
  const base =
    "inline-flex items-center justify-center rounded-sm no-underline transition-colors motion-safe:duration-150";
  const sizes = {
    md: "min-h-12 px-5 text-body",
    lg: "min-h-13 px-6 text-body md:min-h-14 md:px-7",
  } as const;

  const variants = {
    // `text-background` rather than a literal: the accent is light, so its label is the ground.
    solid: "bg-accent font-medium text-background hover:bg-accent/90",
    quiet: "text-muted hover:text-foreground",
  } as const;

  const classes = `${base} ${sizes[size]} ${variants[variant]} ${className}`;

  // An internal href has to keep the reader in their language. `Link` from `i18n/navigation`
  // prefixes the current locale; a plain anchor would drop a Spanish reader back into `/en` on the
  // first click, which is the least visible and most annoying way to break a translated site.
  // External hrefs (the app itself) are absolute and must not be rewritten.
  return href.startsWith("/") ? (
    <Link href={href} className={classes}>
      {children}
    </Link>
  ) : (
    <a href={href} className={classes}>
      {children}
    </a>
  );
}
