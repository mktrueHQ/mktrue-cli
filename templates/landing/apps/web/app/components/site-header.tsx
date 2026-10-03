import { useTranslations } from "next-intl";

import { config, hasApi, hasApp } from "@/lib/config";
import { Link } from "@/i18n/navigation";

import { Container } from "./container";
import { Cta } from "./cta";
import { Lockup } from "./mark";

/**
 * Mark left; right, "Request access" as the one solid button, and "Go to the app" as a quiet link
 * beside it for those already invited. "View the source" is gone.
 *
 * On the phone only "Request access" survives. It is the one thing this page asks of the reader it
 * is written for, and at 360px a second target beside the wordmark either wraps into a second row
 * or shrinks below the tap minimum. The hero and the footer still link to the app.
 *
 * **Except on /request-access, which drops it.** There it would link to the page it sits on, right
 * above the form's own "Request access" submit: two identical accent buttons, and a reader who taps
 * the first one they see reloads the page instead of sending the request.
 *
 * **The hidden link is hidden by its wrapper, not by its own classes.** `Cta` carries
 * `inline-flex`, and Tailwind resolves a same-property conflict by stylesheet order rather than
 * class-attribute order, so `hidden md:inline-flex` on a button loses and the header overflowed at
 * 360px.
 *
 * **Spanish is why the single-CTA rule below 768px stays.** "Solicitar acceso" is 16 characters
 * against the header's budget of 18: one button fits beside the wordmark in both languages, and two
 * want about 370px of a 358px measure.
 */
export function SiteHeader({
  hideRequestAccess = false,
}: {
  readonly hideRequestAccess?: boolean;
}) {
  const t = useTranslations("Header");

  return (
    <header className="sticky top-0 z-20 border-b border-lines bg-background/85 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between md:h-22">
        <Link href="/" className="no-underline">
          <Lockup />
        </Link>

        <nav className="flex items-center gap-2">
          {/* Hidden rather than rendered as `href=""` when the app URL is unset: fail closed,
              applied to a link (CLAUDE.md §4.5). */}
          {hasApp && (
            <span className="hidden md:flex">
              <Cta href={config.appUrl} variant="quiet">
                {t("goToApp")}
              </Cta>
            </span>
          )}
          {hasApi && !hideRequestAccess && (
            <Cta href="/request-access" variant="solid">
              {t("requestAccess")}
            </Cta>
          )}
        </nav>
      </Container>
    </header>
  );
}
