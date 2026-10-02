import { describe, expect, it } from "vitest";

import { sweep, withoutComments, type SweptFile } from "../test-support/source-sweep";

const ADMISSION_DIRECTORIES = ["middlewares", "contexts/auth"] as const;

const PROFILE_IMPORT =
  /(?:\bfrom|\bimport)\s*\(?\s*["'][^"']*(?:contexts\/|\.\.\/)profile(?:\/|["'])/;

const AUTH_IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["'][^"']*(?:contexts\/|\.\.\/)auth\//;

const admissionFiles = async (): Promise<SweptFile[]> =>
  (await Promise.all(ADMISSION_DIRECTORIES.map((directory) => sweep(directory)))).flat();

describe("what decides admission imports from the profile", () => {
  it("walks the gate and the auth context rather than an empty directory", async () => {
    const files = await admissionFiles();
    const paths = files.map((file) => file.path);

    expect(paths).toContain("middlewares/require-user.ts");
    expect(paths).toContain("contexts/auth/application/ports.ts");
    expect(
      files
        .filter((file) => file.path === "middlewares/require-user.ts")
        .map((file) => AUTH_IMPORT.test(file.code)),
    ).toEqual([true]);
  });

  it("is nothing, in middlewares/ or contexts/auth/", async () => {
    expect(
      (await admissionFiles())
        .filter((file) => PROFILE_IMPORT.test(file.code))
        .map((file) => file.path),
    ).toEqual([]);
  });

  it("names a planted import in every spelling, and not a mention or a neighbour", () => {
    const planted: SweptFile[] = [
      {
        path: "middlewares/static.ts",
        code: 'import { getProfile } from "../contexts/profile/application/get-profile";',
      },
      {
        path: "contexts/auth/infrastructure/relative.ts",
        code: 'import type { UserProfile } from "../../profile/domain/user-profile";',
      },
      {
        path: "middlewares/dynamic.ts",
        code: 'const adapter = await import("../contexts/profile/infrastructure/mongoose-user-profile-repository");',
      },
      {
        path: "middlewares/re-export.ts",
        code: 'export { UserProfile } from "@api/contexts/profile/domain/user-profile";',
      },
    ];
    const innocent: SweptFile[] = [
      {
        path: "middlewares/mention.ts",
        code: withoutComments('// never import from "../contexts/profile/" here\nconst x = 1;'),
      },
      {
        path: "middlewares/neighbour.ts",
        code: 'import { ExampleItem } from "../contexts/example/domain/example-item";',
      },
    ];

    expect(
      [...planted, ...innocent]
        .filter((file) => PROFILE_IMPORT.test(file.code))
        .map((file) => file.path),
    ).toEqual(planted.map((file) => file.path));
  });
});
