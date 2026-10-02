import type { ReactNode } from "react";

/**
 * A pass-through, deliberately.
 *
 * Next requires a root layout, but `<html>` and `<body>` belong to `[locale]/layout.tsx` because
 * that is the only place the reader's language is known, and `<html lang>` has to carry it. Two
 * layouts both rendering `<html>` produce nested documents; this one renders its children and
 * nothing else, which is the shape next-intl's docs settle on for exactly this reason.
 *
 * It sets no metadata either. Everything here is under `[locale]`, so the locale layout is always
 * the nearest one and always wins.
 */
export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return children;
}
