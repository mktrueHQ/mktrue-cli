import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function AuthNotConfigured() {
  const t = useTranslations("edge.notConfigured");

  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-xl font-semibold">{t("heading")}</h1>
      <p className="text-neutral-600">
        {t.rich("body", {
          publishable: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
          secret: "CLERK_SECRET_KEY",
          env: ".env",
          code: (chunks: ReactNode) => <code className="text-neutral-900">{chunks}</code>,
        })}
      </p>
    </main>
  );
}
