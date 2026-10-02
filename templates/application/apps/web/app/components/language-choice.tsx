"use client";

import type { Locale } from "@__MKTRUE_NAME__/contracts";
import { useLocale, useTranslations } from "next-intl";
import { useOptimistic, useState, useTransition } from "react";

import { setLocale } from "@/app/actions/profile";

export function LanguageChoice({ locales }: { readonly locales: readonly Locale[] }) {
  const stored = useLocale();
  const t = useTranslations("shell.locale");
  const [shown, showChosen] = useOptimistic<Locale>(stored);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [, startChoosing] = useTransition();

  if (locales.length < 2) return null;

  function choose(locale: Locale) {
    startChoosing(async () => {
      showChosen(locale);
      setRefusal(null);
      try {
        const result = await setLocale({ locale });
        if (result.status === "error") setRefusal(result.message);
      } catch {
        setRefusal(t("refused.unreachable"));
      }
    });
  }

  return (
    <fieldset className="flex items-center gap-3 text-sm">
      <legend className="sr-only">{t("legend")}</legend>
      {locales.map((locale) => (
        <label key={locale} className="flex items-center gap-1">
          <input
            type="radio"
            name="locale"
            value={locale}
            checked={shown === locale}
            onChange={() => choose(locale)}
          />
          <span lang={locale}>{languageName(locale)}</span>
        </label>
      ))}
      {refusal === null ? null : (
        <p role="alert" className="text-red-700">
          {refusal}
        </p>
      )}
    </fieldset>
  );
}

function languageName(locale: Locale): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
}
