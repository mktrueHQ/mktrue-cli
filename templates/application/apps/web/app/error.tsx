"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  const t = useTranslations("shell");

  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-xl font-semibold">{t("boundary.heading")}</h1>
      <p className="text-neutral-600">{t("boundary.body")}</p>
      <div className="flex gap-4">
        <button type="button" onClick={reset} className="rounded-md border px-4 py-2">
          {t("boundary.retry")}
        </button>
        <Link href="/" className="px-4 py-2">
          {t("backHome")}
        </Link>
      </div>
      {error.digest === undefined ? null : (
        <p className="text-sm text-neutral-500">
          {t("boundary.reference", { digest: error.digest })}
        </p>
      )}
    </main>
  );
}
