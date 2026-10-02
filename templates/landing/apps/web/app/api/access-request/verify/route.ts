import type { NextRequest } from "next/server";

import { forwardAccessRequest } from "@/lib/access-request";

/** Step 2, proxied server-side. */
export function POST(request: NextRequest) {
  return forwardAccessRequest(request, "verify");
}
