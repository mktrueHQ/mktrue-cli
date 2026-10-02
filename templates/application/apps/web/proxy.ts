import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { authEnabled } from "@/lib/auth-enabled";

export const PUBLIC_PAGES: readonly string[] = ["/sign-in"];

export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

const protectEveryOtherPage = clerkMiddleware(async (auth, request) => {
  if (isPublicPage(request.nextUrl.pathname)) return;
  await auth.protect({ unauthenticatedUrl: new URL("/sign-in", request.url).toString() });
});

export default authEnabled(process.env) ? protectEveryOtherPage : () => NextResponse.next();

export const config = {
  matcher: [
    "/((?!_next|.*\\.(?:ico|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|txt|xml|webmanifest)$).*)",
  ],
};
