import { headers } from "next/headers";
import { NextResponse } from "next/server";

if (process.env.NODE_ENV !== "development") {
  throw new Error("dev session: the @clerk/nextjs/server stand-in loaded outside next dev");
}

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function auth() {
  if (!isLoopback((await headers()).get("host"))) {
    throw new Error(
      "dev session: refused a request not addressed to this machine by a loopback name",
    );
  }
  const userId = devSessionUserId();
  return { userId, getToken: async () => userId };
}

export function clerkMiddleware() {
  return (request: Request) =>
    isLoopback(request.headers.get("host"))
      ? NextResponse.next()
      : new NextResponse(null, { status: 403 });
}

function isLoopback(host: string | null): boolean {
  return LOOPBACK_HOSTNAMES.has(hostnameOf(host ?? ""));
}

function hostnameOf(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0] ?? "";
}

function devSessionUserId(): string {
  const userId = process.env.DEV_AUTH_USER_ID;
  if (!userId) throw new Error("dev session: DEV_AUTH_USER_ID is not set in this process");
  return userId;
}
