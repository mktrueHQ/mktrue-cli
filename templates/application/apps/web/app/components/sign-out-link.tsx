"use client";

import { SignOutButton } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

export function SignOutLink() {
  const t = useTranslations("shell");

  return (
    <SignOutButton redirectUrl="/sign-in">
      <button type="button" className="mt-4 rounded-md border px-4 py-2">
        {t("signOut")}
      </button>
    </SignOutButton>
  );
}
