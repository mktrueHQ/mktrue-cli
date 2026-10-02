import { useTranslations } from "next-intl";
import { redirect } from "next/navigation";

import { SignOutLink } from "@/app/components/sign-out-link";
import type { ApiFailure } from "@/lib/api";
import { apiFailureCopy, isNoAccess, NO_ACCESS_PATH } from "@/lib/api-failure";

export function ApiFailureCard({ failure }: { readonly failure: ApiFailure }) {
  const t = useTranslations("shell.failure");

  if (isNoAccess(failure)) redirect(NO_ACCESS_PATH);

  const copy = apiFailureCopy(failure);

  return (
    <div role="alert" className="mt-6 rounded-lg border border-neutral-200 p-4">
      <h2 className="font-semibold">{t(copy.title)}</h2>
      <p className="mt-2 text-neutral-600">{t(copy.detail)}</p>
      {copy.needsDifferentSession ? <SignOutLink /> : null}
    </div>
  );
}
