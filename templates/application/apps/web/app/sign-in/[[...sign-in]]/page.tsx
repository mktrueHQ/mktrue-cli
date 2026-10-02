import { SignIn } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

import { AuthNotConfigured } from "@/app/components/auth-not-configured";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const t = useTranslations("edge.signIn");

  if (!config.authEnabled) return <AuthNotConfigured />;

  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 p-6">
      <p className="text-neutral-600">{t("note")}</p>
      <SignIn path="/sign-in" />
    </main>
  );
}
