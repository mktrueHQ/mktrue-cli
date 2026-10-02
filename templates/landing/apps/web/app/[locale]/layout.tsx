import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { config } from "@/lib/config";
import { routing } from "@/i18n/routing";
import { buildPageMetadata } from "@/lib/seo";

import "../globals.css";

/*
 * The three families, self-hosted. `next/font/google` downloads each at build time and serves it
 * from this origin — the browser never makes a request to Google, which is what lets the privacy
 * band claim what it claims. Each declares a CSS variable that `globals.css` composes into
 * `--font-sans` / `--font-display` / `--font-mono` with real fallbacks behind it.
 *
 * Archivo is a variable font, so it carries no `weight` — the 500 and 600 the design uses come
 * off its weight axis. The two Plex families are static and name their weights explicitly, which
 * is also what keeps the download to the four files the page actually uses.
 */
const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-plex-mono",
});

/**
 * `metadataBase` is what turns the relative URLs Next generates for the share card into absolute
 * ones. Without it `og:image` ships as a path, and a crawler on someone else's domain has nothing
 * to resolve it against, which is one of the two reasons a link here used to unfurl as a grey
 * rectangle.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });

  return {
    metadataBase: new URL(config.siteUrl),
    ...buildPageMetadata({
      locale,
      path: "",
      title: t("home.title"),
      description: t("home.description"),
      siteName: t("siteName"),
    }),
  };
}

/** Both locales are prerendered. Without this the pages opt into dynamic rendering. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// `themeColor` mirrors `--color-background` in globals.css. Two copies of one hex — keep them in
// sync. There is no light theme to fall back to: the palette IS the dark palette.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d10",
};

/**
 * The real layout. No auth provider, no service worker, no nav: this is one public page.
 *
 * `text-body` on `<body>` is the one place the page's reading size is set, and the reason no
 * section has to remember to opt into it.
 *
 * **`lang` is the locale, not a hardcoded "en".** It was hardcoded until an earlier decision, which meant a
 * screen reader announced Spanish copy in an English voice and a search engine was told the wrong
 * thing about a page it was being asked to index in two languages.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const { locale } = await params;

  // An unknown locale is a 404, not a silent fallback to English: `/de/privacy` rendering the
  // English page under a German URL is the kind of thing that gets indexed and stays indexed.
  if (!hasLocale(routing.locales, locale)) notFound();

  // Opts this request into static rendering. Without it every page becomes dynamic the moment a
  // component calls `useTranslations`.
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body className="bg-background font-sans text-body text-foreground antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
