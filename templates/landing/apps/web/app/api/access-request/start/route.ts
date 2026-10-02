import type { NextRequest } from "next/server";

import { forwardAccessRequest } from "@/lib/access-request";

/** Step 1, proxied server-side. The browser never learns the API exists. */
export function POST(request: NextRequest) {
  return forwardAccessRequest(request, "start");
}
