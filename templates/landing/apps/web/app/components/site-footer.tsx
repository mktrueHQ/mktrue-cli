import { useLocale, useTranslations } from "next-intl";

import { config, hasApi, hasApp } from "@/lib/config";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

import { Container } from "./container";
import { Mark } from "./mark";

/**
 * A real footer, replacing the single provenance line.
 *
 * A closed beta asks a stranger for their email address. The least it owes them in return is a
 * visible route to what happens to it, so Privacy and Terms are here rather than buried.
 */
export function SiteFooter() {
  const t = useTranslations("Footer");

  return (
    <footer className="border-t border-lines bg-dim-ground">
      <Container className="py-14 md:py-16">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))] md:gap-16">
          <div>
            <Mark size={24} />
            <p className="mt-4 max-w-[38ch] text-meta text-muted">{t("tagline")}</p>
          </div>

          <FooterColumn title={t("colProduct")}>
            {hasApp && <FooterLink href={config.appUrl}>{t("goToApp")}</FooterLink>}
            {hasApi && <FooterLink href="/request-access">{t("requestAccess")}</FooterLink>}
            <FooterLink href="/about">{t("about")}</FooterLink>
          </FooterColumn>

          <FooterColumn title={t("colLegal")}>
            <FooterLink href="/privacy">{t("privacy")}</FooterLink>
            <FooterLink href="/terms">{t("terms")}</FooterLink>
          </FooterColumn>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-lines pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-meta text-muted">{t("provenance")}</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
            <LocaleSwitch />
            <p className="font-mono text-meta text-muted">
              &copy; {new Date().getFullYear()} {config.ownerName}
            </p>
          </div>
        </div>
      </Container>
    </footer>
  );
}

/**
 * Two locales, in the footer, as links.
 *
 * The handoff argued for no switcher at all, on the grounds that one of the two locales is already
 * the reader's browser default and a control does not belong in a header that holds one CTA. Half
 * right: the header is the wrong place, and this is the footer. But hreflang is a hint to a
 * crawler and does nothing for a Spanish speaker whose browser reports English, who currently has
 * no way at all to reach `/es` except by editing the address bar.
 *
 * Links rather than a `<select>`, so it works with JavaScript off like everything else here, and
 * so each locale is a real crawlable URL rather than a value in a control. The current one is
 * marked with `aria-current` rather than removed, because a switcher that hides where you are is a
 * switcher you have to think about.
 */
function LocaleSwitch() {
  const locale = useLocale();
  const t = useTranslations("Footer");
  const names: Record<string, string> = { en: t("langEn"), es: t("langEs") };

  return (
    <nav aria-label={t("language")} className="flex items-center gap-2 font-mono text-meta">
      {routing.locales.map((loc, i) => (
        <span key={loc} className="flex items-center gap-2">
          {i > 0 && <span className="text-lines">/</span>}
          {loc === locale ? (
            <span aria-current="true" className="text-foreground">
              {names[loc]}
            </span>
          ) : (
            <Link
              href="/"
              locale={loc}
              className="text-muted no-underline hover:text-accent hover:underline hover:underline-offset-4"
            >
              {names[loc]}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

function FooterColumn({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="font-display text-meta font-medium tracking-[0.09em] text-muted uppercase">
        {title}
      </h2>
      <ul className="mt-4 flex list-none flex-col gap-3 p-0">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { readonly href: string; readonly children: string }) {
  const classes =
    "text-meta text-foreground no-underline hover:text-accent hover:underline hover:underline-offset-4";

  return (
    <li>
      {href.startsWith("/") ? (
        <Link href={href} className={classes}>
          {children}
        </Link>
      ) : (
        <a href={href} className={classes}>
          {children}
        </a>
      )}
    </li>
  );
}
