"use client";

import { useTranslations } from "next-intl";

import { useState, useSyncExternalStore } from "react";

/**
 * The one interactive thing on the site, and the only client component in the app.
 *
 * Three steps as one machine, **fill to verify to sent**, with `sent` as a real step rather than a
 * separate screen, so the indicator stays on show and finishes filled in. Swapping the form out for
 * a confirmation card leaves the reader with no evidence of what they just completed.
 *
 * No form library and no stepper library: three states and two fetches do not earn a dependency
 * (CLAUDE.md §4.8). Field shapes are the API's. It validates, and a second copy of the rules here
 * would be a fork of the contract.
 */
type Step = "fill" | "verify" | "sent";

const STEPS: readonly Step[] = ["fill", "verify", "sent"];

/** Nothing to subscribe to: the one change that matters is hydration, which re-renders by itself. */
const noSubscription = () => () => {};

export function RequestAccessForm() {
  const t = useTranslations("Form");

  // False in the prerendered HTML and through hydration, true once the client has taken over, and
  // true from the very first render when the form mounts on a client-side navigation from `/`,
  // which is why this is a store and not an effect. The fields stay disabled until then, so
  // nobody can fill in a form that has nothing listening to it yet.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  const [step, setStep] = useState<Step>("fill");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [returned, setReturned] = useState(false);
  const [sentTo, setSentTo] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (step === "fill") {
        // The field stays editable while this is out, so the address is kept as it was sent: that
        // is the one the verify hint has to name, typo and all.
        const address = email;
        const res = await post("/api/access-request/start", {
          email: address,
          note: note || undefined,
        });
        if (!res.ok) return setError(messageFor(t, res.status, "fill"));
        setToken(((await res.json()) as { token: string }).token);
        setSentTo(address);
        setStep("verify");
      } else {
        const res = await post("/api/access-request/verify", { token, code });
        if (!res.ok) return setError(messageFor(t, res.status, "verify"));
        setStep("sent");
      }
    } catch {
      // Network failure. The typed values are still in state and still on screen: a failed submit
      // never discards work (CLAUDE.md, the ui-engineer's rules).
      setError(t("errNetwork"));
    } finally {
      setBusy(false);
    }
  }

  // Back to the first step with the address and the note still typed in. A code sent to a mistyped
  // address never arrives, and until this the verify step's only way out was a reload that lost
  // both. `returned` puts focus back on the address, since the button that was pressed is gone.
  function changeAddress() {
    setStep("fill");
    setCode("");
    setToken("");
    setError(null);
    setReturned(true);
  }

  // `post`, so no browser can ever serialise the address into a query string (CLAUDE.md §4.3). With
  // no method a form defaults to GET, and before an earlier decision a submit without JavaScript did exactly that:
  // `?email=…&note=…`, in the URL, in access logs we do not control.
  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-5">
      {/* `role="list"` because WebKit drops the list role from a `list-none` list, and VoiceOver
          then never reads the label at all. */}
      <ol role="list" className="flex list-none items-center gap-2 p-0" aria-label={t("progress")}>
        {STEPS.map((id) => (
          <li
            key={id}
            aria-current={id === step ? "step" : undefined}
            className={`h-1 flex-1 rounded-full ${
              STEPS.indexOf(id) <= STEPS.indexOf(step) ? "bg-accent" : "bg-lines"
            }`}
          >
            {/* `aria-current="step"` marks the current one. NVDA and JAWS say so, VoiceOver and
                TalkBack less reliably, and each step's own field label says where the reader is
                either way. A text marker would be read twice by the first two. */}
            <span className="sr-only">{t(`steps.${id}`)}</span>
          </li>
        ))}
      </ol>

      {step === "sent" ? (
        <div className="flex flex-col gap-3">
          <p className="font-display text-lead font-medium">{t("sentTitle")}</p>
          {/* an earlier decision, said plainly. Anything warmer would promise a timeline that does not exist. */}
          <p className="text-muted">{t("sentBody")}</p>
          <p className="font-mono text-meta text-muted">{t("sentMeta")}</p>
        </div>
      ) : (
        <fieldset disabled={!hydrated} className="flex min-w-0 flex-col gap-5">
          {step === "fill" && (
            <>
              <Field label={t("emailLabel")} hint={t("emailHint")}>
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  autoFocus={returned}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-h-12 rounded-sm border border-control bg-background px-3.5 text-body text-foreground"
                />
              </Field>

              <Field label={t("noteLabel")} hint={t("noteHint")}>
                <textarea
                  name="note"
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="rounded-sm border border-control bg-background px-3.5 py-3 text-body text-foreground"
                />
              </Field>
            </>
          )}

          {/* The hint names the address the code went to, so a typo shows up exactly where the
              code is not arriving, right above the way back to fix it. */}
          {step === "verify" && (
            <Field label={t("codeLabel")} hint={t("codeHint", { email: sentTo })}>
              <input
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="min-h-12 rounded-sm border border-control bg-background px-3.5 font-mono text-body tracking-[0.4em] text-foreground"
              />
            </Field>
          )}

          {error !== null && (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="min-h-12 rounded-sm bg-accent px-5 text-body font-medium text-background disabled:opacity-60"
          >
            {busy ? t("working") : step === "fill" ? t("submitFill") : t("submitVerify")}
          </button>

          {/* Disabled while a code is being checked: going back mid-request would let the answer
              land on the wrong step. */}
          {step === "verify" && (
            <button
              type="button"
              onClick={changeAddress}
              disabled={busy}
              className="min-h-11 self-center py-2 text-meta text-accent underline underline-offset-4 disabled:opacity-60"
            >
              {t("changeAddress")}
            </button>
          )}
        </fieldset>
      )}
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-mono text-meta tracking-[0.06em] text-muted uppercase">{label}</span>
      {children}
      {/* A hint can hold the reader's address, and an address has no spaces to wrap at. */}
      <span className="text-meta text-muted [overflow-wrap:anywhere]">{hint}</span>
    </label>
  );
}

function post(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * The API's error codes are deliberately coarse. A wrong code and an expired one are the same
 * answer, so that neither reveals whether a token is still live. The copy here has to respect that
 * and stay honest about the ambiguity rather than guessing which happened.
 */
function messageFor(
  t: (key: string, values?: Record<string, string>) => string,
  status: number,
  step: "fill" | "verify",
): string {
  if (status === 429) return t("errRate");
  if (status === 503) return t("errMail");
  // Anything else is ours, not theirs. Never blame the input for a server fault: an unmapped 500
  // used to fall through to "that address does not look right", which sends someone off editing a
  // perfectly good address.
  if (status >= 500) return t("errServer");
  if (step === "fill") return t("errAddress");
  // Names the way back by its own label, so the two cannot drift apart.
  return t("errCode", { back: t("changeAddress") });
}
