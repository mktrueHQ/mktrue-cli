/**
 * Stand-in for the `server-only` package under Vitest.
 *
 * `lib/config.ts` and `lib/access-request.ts` import `server-only` so that a stray client import of
 * either fails the **build** — which is what keeps `API_BASE_URL` out of the browser bundle. The
 * real module throws on import outside a Server Component, and Vitest is neither, so every page
 * test died on it.
 *
 * Stubbing it here keeps the guarantee where it belongs: `next build` still enforces the boundary
 * for real, and the tests get to render the page. Aliased in `vitest.config.ts`.
 */
export {};
