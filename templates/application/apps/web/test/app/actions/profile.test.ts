import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiResult } from "@/lib/api";

const sent = vi.hoisted(() => ({
  locales: [] as string[],
  answer: { status: "ok", data: {} } as ApiResult<object>,
}));
vi.mock("@/lib/profile", () => ({
  sendLocale: async (locale: string) => {
    sent.locales.push(locale);
    return sent.answer;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

const { setLocale } = await import("@/app/actions/profile");

beforeEach(() => {
  sent.locales.length = 0;
  sent.answer = { status: "ok", data: {} };
});

describe("setLocale", () => {
  it("sends a locale the contract declares", async () => {
    expect(await setLocale({ locale: "en" })).toEqual({ status: "ok" });
    expect(sent.locales).toEqual(["en"]);
  });

  it.each([["xx"], [""], [42], [undefined], [{ locale: "en" }]])(
    "refuses %j without calling the API",
    async (locale) => {
      expect(await setLocale({ locale })).toEqual({
        status: "error",
        message: "shell.locale.refused.rejected",
      });
      expect(sent.locales).toEqual([]);
    },
  );

  it.each([
    [{ status: "unauthenticated" }, "session"],
    [{ status: "forbidden" }, "account"],
    [{ status: "unavailable", reason: "storage" }, "unavailable"],
    [{ status: "invalid" }, "rejected"],
  ] as const)("says why the API refused %j", async (answer, key) => {
    sent.answer = answer;

    expect(await setLocale({ locale: "en" })).toEqual({
      status: "error",
      message: `shell.locale.refused.${key}`,
    });
  });
});
