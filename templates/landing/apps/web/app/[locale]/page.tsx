import { useTranslations } from "next-intl";

import { Container } from "@/app/components/container";
import { Cta } from "@/app/components/cta";
import { hasApi } from "@/lib/config";

/**
 * The home page, deliberately almost empty.
 *
 * Everything a landing page says is that product's own argument, so a template
 * that shipped one would make every product a page about somebody else. What
 * this ships is the shape — a heading, a sentence, one call to action — and the
 * copy that fills it lives in `messages/`, in both locales, where a product
 * rewrites it. The call to action is there only while the page it leads to is.
 */
export default function HomePage() {
  const t = useTranslations("Home");

  return (
    <Container className="py-20 md:py-28">
      <h1 className="max-w-[18ch] text-display font-semibold tracking-tight text-ink">
        {t("title")}
      </h1>
      <p className="mt-6 max-w-[52ch] text-body text-muted">{t("tagline")}</p>
      {hasApi && (
        <div className="mt-10">
          <Cta href="/request-access" variant="solid" size="lg">
            {t("requestAccess")}
          </Cta>
        </div>
      )}
    </Container>
  );
}
