import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every catalogue in `messages/`, read from disk rather than imported by name.
 *
 * Importing `en` and `es` by name means a product with one locale cannot compile
 * its own tests, and a product that adds a third gets no coverage of it until
 * somebody remembers to edit this file. Reading the directory makes the suite
 * follow the locales instead of the other way round.
 */
const MESSAGES_DIR = join(import.meta.dirname, "..", "messages");
const CATALOGUES = new Map<string, Record<string, unknown>>(
  readdirSync(MESSAGES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [
      f.replace(/\.json$/, ""),
      JSON.parse(readFileSync(join(MESSAGES_DIR, f), "utf8")) as Record<string, unknown>,
    ]),
);

/**
 * The copy rules, tested against the copy rather than against rendered HTML.
 *
 * They used to be scraped out of `renderToStaticMarkup` output, which was the only place the
 * strings existed. Now that every string lives in a catalogue, asserting on the catalogue
 * is both more direct and the only way to cover a locale the tests never render: a Spanish em dash
 * or an untranslated key would otherwise ship unnoticed because no test ever asked for `/es`.
 */

type Locale = string;
const LOCALES: readonly Locale[] = [...CATALOGUES.keys()].sort();

/**
 * Every leaf as a dotted path → value, so a failure names the string it is talking about.
 *
 * It recurses, and that is not incidental. The catalogues were first written with dotted keys at
 * one level (`"home.title"`), which next-intl resolves as a *path* into nested objects, so every
 * such key rendered as its own name: the document title shipped as the literal text
 * `Meta.home.title`. A flatten that only walked one level could not see the difference.
 */
function flatten(node: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }

  return out;
}

const FLAT = new Map(LOCALES.map((l) => [l, flatten(CATALOGUES.get(l)!)] as const));

describe("the catalogues", () => {
  it("have exactly the same keys", () => {
    // Every locale against the default, so the assertion holds for one locale,
    // two, or five. A product that adds a string in one language and not another
    // fails here rather than shipping a key that renders as its own name.
    const base = FLAT.get(LOCALES[0]!)!;
    for (const locale of LOCALES.slice(1)) {
      const other = FLAT.get(locale)!;
      expect(
        [...base.keys()].filter((k) => !other.has(k)),
        `missing from ${locale}`,
      ).toEqual([]);
      expect(
        [...other.keys()].filter((k) => !base.has(k)),
        `extra in ${locale}`,
      ).toEqual([]);
    }
  });

  it.each(LOCALES)("has no empty string in %s", (locale) => {
    const empty = [...FLAT.get(locale)!].filter(([, v]) => v.trim() === "").map(([k]) => k);

    expect(empty, "an empty string renders as a gap nobody notices").toEqual([]);
  });
});

describe("the house style", () => {
  it.each(LOCALES)("uses no em dash in %s", (locale) => {
    const offenders = [...FLAT.get(locale)!].filter(([, v]) => v.includes("—")).map(([k]) => k);

    expect(offenders, "write a comma, a colon or a full stop instead").toEqual([]);
  });

  /**
   * Bare "self-host" is deliberately absent, and the first draft of this proved why: it failed on
   * `About.s4`, which used to say "nobody in the beta self-hosts anything". The denial contains the
   * word. A guard that cannot tell a claim from its refutation pushes copy into euphemism, which is
   * the failure mode an earlier decision exists to prevent.
   */
  const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
    [/\bsaas\b/, "a word for other engineers"],
    [/single-tenant|multi-tenant/, "true of the architecture, false as an offer"],
    [/\bmcp\b|\boauth\b/, "name the capability, not the protocol"],
    [/whitelist|lista blanca/, "say invitation, or a list edited by hand"],
    [/your vps|tu vps/, "the reader gets no server"],
    [/one tenant|un inquilino/, "the tenant is the author's"],
    [/\byou\b[^.]{0,40}self-host/, "the offer form. The denial form is fine"],
  ];

  it.each(LOCALES)("uses no insider jargon in %s", (locale) => {
    for (const [pattern, why] of FORBIDDEN) {
      const offenders = [...FLAT.get(locale)!]
        .filter(([, v]) => pattern.test(v.toLowerCase()))
        .map(([k]) => k);

      expect(offenders, `${String(pattern)}: ${why}`).toEqual([]);
    }
  });
});

/**
 * The character budgets, measured at 390px: the design handoff for briefs 1 and 2 set most of them,
 * and an earlier decision added `Hero.body`. The `Device.row*` ceilings are the **share card's** now, not the
 * hero's: the hero frame became a capture in an earlier decision, and the card is the last thing drawing that
 * device in markup.
 *
 * A budget in a design document is a suggestion. Most of these are strings whose layout breaks
 * rather than merely reflows. `Hero.body` only reflows, but a fifth line of it takes the device back
 * under the first screen. Spanish runs 15 to 25 percent longer than English, so the English string
 * passing tells you nothing. Each ceiling has a stated failure below it, because a number with no
 * reason attached is a number the next person raises when it gets inconvenient.
 */
describe("the character budgets", () => {
  const BUDGETS: readonly (readonly [string, number, string])[] = [
    ["Header.requestAccess", 18, "one button beside the wordmark at 358px; two need 370px"],
    ["Home.tagline", 155, "four lines at 390x844 before the call to action goes below the fold"],
    ["Footer.tagline", 155, "the same sentence, the same ceiling"],
    ["Form.submitFill", 22, "the button is the widest thing in the form at 390px"],
    ["Form.submitVerify", 22, "the same button, second step"],
  ];

  it.each(LOCALES)("hold every budgeted string in %s", (locale) => {
    const flat = FLAT.get(locale)!;

    for (const [key, ceiling, why] of BUDGETS) {
      const value = flat.get(key);
      expect(value, `${key} is missing`).toBeDefined();
      expect(
        value!.length,
        `${key} = "${value}" (${value!.length}). Budget ${ceiling}: ${why}`,
      ).toBeLessThanOrEqual(ceiling);
    }
  });

  it("keeps a value that must not be translated identical across locales", () => {
    // A number or a product name means the same thing in every language, and a
    // translator who renders it differently has introduced a bug nobody reads.
    // A product adds its own keys here; the shipped catalogue has one.
    for (const key of ["Meta.siteName"]) {
      const base = FLAT.get(LOCALES[0]!)!.get(key);
      for (const locale of LOCALES.slice(1)) {
        expect(FLAT.get(locale)!.get(key), `${key} differs in ${locale}`).toBe(base);
      }
    }
  });
});

/**
 * The bug this catches shipped for about twenty minutes and reached the document title.
 *
 * next-intl reads a dot in a key as a path into nested objects, so a flat key called `"home.title"`
 * resolves to nothing and the library renders the key itself. The page looked fine in a rendering
 * test that only asserted on the handful of keys with no dots in them, while `<title>` said
 * `Meta.home.title` and the three hero proof numbers said `Hero.proof.time.value` and friends.
 *
 * So: no message may contain a dot in a key segment, which is the same thing as saying the
 * catalogue must be genuinely nested rather than flat with dotted names.
 */
describe("the catalogue shape", () => {
  it.each(LOCALES)("nests %s rather than using dotted key names", (locale) => {
    const walk = (node: unknown, path: string): string[] =>
      Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
        key.includes(".")
          ? [`${path}${key}`]
          : typeof value === "string"
            ? []
            : walk(value, `${path}${key}.`),
      );

    expect(walk(CATALOGUES.get(locale)!, ""), "a dot in a key renders as the key itself").toEqual(
      [],
    );
  });
});
