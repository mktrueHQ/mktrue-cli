import { useTranslations } from "next-intl";
import Link from "next/link";

export default function NotFound() {
  const t = useTranslations("shell");

  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-xl font-semibold">{t("notFound.heading")}</h1>
      <p className="text-neutral-600">{t("notFound.body")}</p>
      <Link href="/">{t("backHome")}</Link>
    </main>
  );
}
