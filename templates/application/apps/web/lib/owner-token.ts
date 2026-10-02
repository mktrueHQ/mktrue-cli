import "server-only";

import { auth } from "@clerk/nextjs/server";

import { config } from "./config";

export async function ownerToken(): Promise<string | null> {
  if (!config.authEnabled) return null;

  try {
    const { getToken } = await auth();
    return await getToken();
  } catch (error) {
    if (!isMissingMiddlewareContext(error)) throw error;
    console.warn("ownerToken: no Clerk middleware ran for this request; refusing the call");
    return null;
  }
}

function isMissingMiddlewareContext(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("can't detect usage of clerkMiddleware()")
  );
}
