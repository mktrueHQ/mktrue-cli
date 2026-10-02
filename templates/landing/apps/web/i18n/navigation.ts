import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Locale-aware `Link` and friends. Importing these rather than `next/link` is what keeps an
 * internal href from dropping the reader back into the default locale mid-visit.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
