import {
  EXAMPLE_ITEM_STATUSES,
  listExampleItemsQuerySchema,
  type ExampleItemStatus,
} from "@__MKTRUE_NAME__/contracts";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { ApiFailureCard } from "@/app/components/api-failure-card";
import { AuthNotConfigured } from "@/app/components/auth-not-configured";
import { config } from "@/lib/config";
import { statusKey } from "@/lib/example-item-status";
import { listExampleItems } from "@/lib/example-items";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ExampleItemsPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  if (!config.authEnabled) return <AuthNotConfigured />;

  const filter = listExampleItemsQuerySchema.safeParse(await searchParams);
  const shown: ExampleItemStatus | undefined = filter.success ? filter.data.status : undefined;
  const [t, result] = await Promise.all([getTranslations("exampleItems"), listExampleItems(shown)]);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">{t("heading")}</h1>
      <nav aria-label={t("filter")} className="mt-4 flex gap-4 text-sm">
        <Link href="/" aria-current={shown === undefined ? "page" : undefined}>
          {t("all")}
        </Link>
        {EXAMPLE_ITEM_STATUSES.map((status) => (
          <Link
            key={status}
            href={`/?status=${status}`}
            aria-current={shown === status ? "page" : undefined}
          >
            {t(`status.${statusKey(status)}`)}
          </Link>
        ))}
      </nav>
      {result.status !== "ok" ? (
        <ApiFailureCard failure={result} />
      ) : result.data.length === 0 ? (
        <p className="mt-6 text-neutral-600">{t("empty")}</p>
      ) : (
        <ul className="mt-6 divide-y divide-neutral-200">
          {result.data.map((item) => (
            <li key={item.id} className="flex justify-between gap-4 py-3">
              <span>{item.title}</span>
              <span className="text-sm text-neutral-600">
                {t(`status.${statusKey(item.status)}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
