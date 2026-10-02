import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { RequestAccessForm } from "@/app/components/request-access-form";
import { SiteFooter } from "@/app/components/site-footer";
import { SiteHeader } from "@/app/components/site-header";
import { config, hasApp } from "@/lib/config";
import { buildPageMetadata } from "@/lib/seo";

type Props = { readonly params: Promise<{ readonly locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });

  return buildPageMetadata({
    locale,
    path: "/request-access",
    title: t("request.title"),
    description: t("request.description"),
    siteName: t("siteName"),
  });
}

/**
 * Its own route rather than a dialog on `/`.
 *
 * A dialog would make the landing page's one interactive element a client component and pull the
 * whole form into the bundle of a page that otherwise ships none. A route also gives the CTA
 * somewhere honest to point when JavaScript is off: the page, its explanation and the link back to
 * the app all render server-side, and only the form itself needs the client.
 */
export default async function RequestAccessPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "RequestAccess" });

  return (
    <>
      <SiteHeader hideRequestAccess />
      {/* `px-5` is the page's gutter (see `Container`), so the card's edge lines up with the
          wordmark in the header above it rather than sitting 4px inside it. */}
      <main id="main" className="mx-auto max-w-[640px] px-5 py-12 md:px-14 md:py-18">
        <h1 className="font-display text-title font-semibold">{t("title")}</h1>

        <p className="mt-4 text-muted">{t("intro", { owner: config.ownerName })}</p>

        {/* Above the card, so a reader without JavaScript meets the reason before a form whose
            fields stay disabled for them. Rendered server-side, the only way it can reach
            that reader at all. */}
        <noscript>
          <p className="mt-6 text-meta text-muted">{t("noscript", { owner: config.ownerName })}</p>
        </noscript>

        <div className="mt-8 rounded-lg border border-lines bg-surface p-5 shadow-inner-light md:p-7">
          <RequestAccessForm />
        </div>

        {/* Guarded, like every other link to the app. This one was not, and it is the exact
            failure an earlier decision claims to have closed everywhere: a blank `NEXT_PUBLIC_APP_URL` rendered
            `href=""` here, a dead end that still looks clickable, because the page test only ever
            rendered `/`. The test now walks every route (CLAUDE.md §4.5, §6). */}
        {hasApp && (
          <p className="mt-6 font-mono text-meta text-muted">
            {t("alreadyIn")}{" "}
            <a href={config.appUrl} className="text-accent underline underline-offset-4">
              {t("goToApp")}
            </a>
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
