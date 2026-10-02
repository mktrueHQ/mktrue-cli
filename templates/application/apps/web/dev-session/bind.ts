import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export const WEB_PORT = __MKTRUE_WEB_PORT__;

export const LOOPBACK_HOST = "localhost";

export const NETWORK_HOST = "0.0.0.0";

export const LOOPBACK_BIND_MARK = { name: "DEV_SESSION_BIND", value: "loopback" } as const;

export const WEB_ENV_FILES = [
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
  "../../.env",
] as const;

export type WebEnvFile = (typeof WEB_ENV_FILES)[number];

export type WebEnvFiles = Readonly<Partial<Record<WebEnvFile, string>>>;

export type DevServerPlan =
  | {
      readonly kind: "start";
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, string>>;
    }
  | { readonly kind: "refuse"; readonly reason: string };

export function planDevServer(
  argv: readonly string[],
  shell: NodeJS.Dict<string>,
  files: WebEnvFiles,
): DevServerPlan {
  if (argv.length === 0) {
    return {
      kind: "start",
      args: ["dev", "-p", String(WEB_PORT), "-H", LOOPBACK_HOST],
      env: { [LOOPBACK_BIND_MARK.name]: LOOPBACK_BIND_MARK.value },
    };
  }

  if (argv.length === 1 && argv[0] === "--lan") {
    const found = firstDefinition(shell, files);
    if (found !== undefined && found.value !== "") {
      return { kind: "refuse", reason: lanRefusal(found.where) };
    }
    return {
      kind: "start",
      args: ["dev", "-p", String(WEB_PORT), "-H", NETWORK_HOST],
      env: { [LOOPBACK_BIND_MARK.name]: "" },
    };
  }

  return {
    kind: "refuse",
    reason:
      "dev takes no arguments: it chooses the port and the bind itself, so the dev session can only ever listen on localhost. Run `dev` for this machine, or `dev:lan` for the network.",
  };
}

interface Definition {
  readonly value: string;
  readonly where: string;
}

function firstDefinition(shell: NodeJS.Dict<string>, files: WebEnvFiles): Definition | undefined {
  if (shell.DEV_AUTH_USER_ID !== undefined) {
    return { value: shell.DEV_AUTH_USER_ID, where: "in your shell" };
  }
  for (const file of WEB_ENV_FILES) {
    const value = parseEnv(files[file] ?? "").DEV_AUTH_USER_ID;
    if (value !== undefined) {
      return {
        value,
        where: file === "../../.env" ? "in the repo-root .env" : `in apps/web/${file}`,
      };
    }
  }
  return undefined;
}

function lanRefusal(where: string): string {
  return (
    `dev:lan refused: DEV_AUTH_USER_ID is set ${where}, so the dev session is on, and anyone ` +
    "on this network who reaches the server would be signed in as that user. Blank it to test " +
    "from another device, or run `dev`, which listens on localhost only."
  );
}

export function readWebEnvFiles(directory: string): WebEnvFiles {
  const files: Partial<Record<WebEnvFile, string>> = {};
  for (const file of WEB_ENV_FILES) {
    try {
      files[file] = readFileSync(resolve(directory, file), "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return files;
}
