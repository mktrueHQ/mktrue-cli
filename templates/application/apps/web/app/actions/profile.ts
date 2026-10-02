"use server";

import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";

import { asLocale } from "@/i18n/locales";
import type { ApiFailure } from "@/lib/api";
import { sendLocale } from "@/lib/profile";

export type ProfileActionResult =
  { readonly status: "ok" } | { readonly status: "error"; readonly message: string };

type RefusalKey = "session" | "account" | "unavailable" | "rejected";

export async function setLocale(input: { readonly locale: unknown }): Promise<ProfileActionResult> {
  const locale = asLocale(typeof input === "object" && input !== null ? input.locale : undefined);
  if (locale === undefined) return await refusal("rejected");

  const result = await sendLocale(locale);
  if (result.status !== "ok") return await refusal(refusalFor(result));

  revalidatePath("/", "layout");
  return { status: "ok" };
}

function refusalFor(failure: ApiFailure): RefusalKey {
  switch (failure.status) {
    case "unauthenticated":
      return "session";
    case "forbidden":
      return "account";
    case "unavailable":
      return "unavailable";
    case "invalid":
    case "notFound":
    case "conflict":
      return "rejected";
  }
}

async function refusal(key: RefusalKey): Promise<ProfileActionResult> {
  const t = await getTranslations("shell.locale.refused");
  return { status: "error", message: t(key) };
}
