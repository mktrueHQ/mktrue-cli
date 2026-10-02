import { useTranslations } from "next-intl";

/**
 * The wordmark, as text.
 *
 * A template that ships a logo ships somebody else's brand, so this is the one
 * component here meant to be thrown away: replace it with the real mark when
 * there is one. The name comes from `Meta.siteName` in `messages/`, so it is
 * already translated and already a product's to change.
 */
export function Mark({ size = 20 }: { size?: number }) {
  const t = useTranslations("Meta");
  return (
    <span className="font-mono font-semibold tracking-tight text-ink" style={{ fontSize: size }}>
      {t("siteName")}
    </span>
  );
}

/** The mark as a header lockup: the same name, at heading size. */
export function Lockup() {
  return <Mark size={22} />;
}
