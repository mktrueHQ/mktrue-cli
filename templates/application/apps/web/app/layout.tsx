import { ClerkProvider } from "@clerk/nextjs";
import { LOCALES } from "@__MKTRUE_NAME__/contracts";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import type { ReactNode } from "react";

import { LanguageChoice } from "@/app/components/language-choice";
import { config } from "@/lib/config";
import { profileIsReadable } from "@/lib/profile";

import "./globals.css";

export const metadata: Metadata = { title: "__MKTRUE_NAME__" };

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const locale = await getLocale();
  const { shell } = await getMessages();
  const canChooseLocale = await profileIsReadable();

  return (
    <html lang={locale}>
      <body className="min-h-dvh bg-white text-neutral-900 antialiased">
        <NextIntlClientProvider locale={locale} messages={{ shell }}>
          <header className="flex items-center justify-between gap-4 border-b border-neutral-200 px-4 py-3">
            <span className="font-semibold">__MKTRUE_NAME__</span>
            {canChooseLocale ? <LanguageChoice locales={LOCALES} /> : null}
          </header>
          {config.authEnabled ? (
            <ClerkProvider signInUrl="/sign-in">{children}</ClerkProvider>
          ) : (
            children
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
