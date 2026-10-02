import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AuthNotConfigured } from "@/app/components/auth-not-configured";
import { SignOutLink } from "@/app/components/sign-out-link";
import { apiFailureCopy } from "@/lib/api-failure";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("edge.noAccess");
  return { title: t("title") };
}

export default function NoAccessPage() {
  const t = useTranslations("shell.failure");

  if (!config.authEnabled) return <AuthNotConfigured />;

  const copy = apiFailureCopy({ status: "forbidden" });

  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-xl font-semibold">{t(copy.title)}</h1>
      <p className="text-neutral-600">{t(copy.detail)}</p>
      {copy.needsDifferentSession ? <SignOutLink /> : null}
    </main>
  );
}
