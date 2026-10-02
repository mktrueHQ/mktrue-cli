import { EXIT, type Finding } from "./findings.js";

const SECRET_NAME = String.raw`[A-Za-z0-9_]*(?:secret|token|password|passwd|api[_-]?key|credential|private[_-]?key)[A-Za-z0-9_]*`;

const HORIZONTAL = String.raw`[^\S\r\n]*`;
const MIN_ASSIGNED = 8;

const MIN_NAMED_ALONE = 16;

const QUOTED_ASSIGNMENT = new RegExp(
  String.raw`\b(${SECRET_NAME})${HORIZONTAL}[:=]${HORIZONTAL}(["'\`])([^"'\`\n]{${MIN_ASSIGNED},})\2`,
  "gi",
);
const ENV_ASSIGNMENT = new RegExp(
  String.raw`^${HORIZONTAL}(${SECRET_NAME})${HORIZONTAL}=${HORIZONTAL}(\S{${MIN_ASSIGNED},})${HORIZONTAL}$`,
  "gim",
);

const VENDOR_TOKEN = new RegExp(
  "\\b(?:" +
    [
      String.raw`sk-[A-Za-z0-9_-]{16,}`,
      String.raw`[sprw]k_(?:live|test)_[A-Za-z0-9]{10,}`,
      String.raw`whsec_[A-Za-z0-9]{16,}`,
      String.raw`ghp_[A-Za-z0-9]{20,}`,
      String.raw`github_pat_[A-Za-z0-9_]{20,}`,
      String.raw`glpat-[A-Za-z0-9_-]{16,}`,
      String.raw`npm_[A-Za-z0-9]{20,}`,
      String.raw`dop_v1_[a-f0-9]{32,}`,
      String.raw`hf_[A-Za-z0-9]{20,}`,
      String.raw`AKIA[0-9A-Z]{16}`,
      String.raw`xox[abprs]-[A-Za-z0-9-]{10,}`,
      String.raw`xapp-[0-9]-[A-Za-z0-9-]{10,}`,
      String.raw`re_[A-Za-z0-9_-]{16,}`,
      String.raw`AIza[A-Za-z0-9_-]{30,}`,
      String.raw`SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}`,
    ].join("|") +
    ")\\b",
);

const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

const PRIVATE_KEY = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/;

const URL_CREDENTIAL = /:\/\/[^\s:/@]+:([^\s:/@]{6,})@/g;

const LONG_LITERAL = /(["'`])([A-Za-z0-9+/=_-]{32,})\1/g;

const PLACEHOLDER =
  /^(?:x{4,}|changeme|placeholder|redacted|dummy|fake|example|test|your|sk-xxx)|[<>]|\$\{/i;

function isPlaceholder(value: string): boolean {
  if (PLACEHOLDER.test(value)) return true;
  return new Set(value).size <= 2;
}

export function entropyOf(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const LONG_ENOUGH_TO_RELAX = 32;

function looksGenerated(value: string): boolean {
  if (value.length >= LONG_ENOUGH_TO_RELAX && /^[0-9a-f]+$/i.test(value) && /[0-9]/.test(value)) {
    return true;
  }
  if (!/[0-9]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[A-Z]/.test(value) && !/[+/=]/.test(value)) return false;
  const ceiling = Math.log2(value.length) - 0.4;
  const floor = Math.min(value.length >= LONG_ENOUGH_TO_RELAX ? 3.6 : 4, ceiling);
  return entropyOf(value) >= floor;
}

const EXAMPLE_QUALIFIER = /^(?:example|sample|template|defaults|dist)$/i;

export function isLiveEnvFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const leading = /^\.env(?:\.(.+))?$/.exec(name);
  const trailing = /^(.+)\.env$/.exec(name);
  if (leading === null && trailing === null) return false;
  const qualifier = leading?.[1] ?? trailing?.[1];
  if (qualifier === undefined) return true;
  return !EXAMPLE_QUALIFIER.test(qualifier);
}

const finding = (path: string, what: string, why: string, fix: string): Finding => ({
  gate: "secret",
  what: `${path} ${what}`,
  why,
  fix,
  exit: EXIT.FINDINGS,
});

export function scanSecrets(path: string, content: string): Finding[] {
  const findings: Finding[] = [];

  if (isLiveEnvFile(path)) {
    findings.push(
      finding(
        path,
        "is an environment file, not an example of one",
        "a template is committed and rendered into other repositories, so a real .env published from it is published everywhere it lands",
        `remove ${path} from the template manifest, and name .env.example instead`,
      ),
    );
  }

  if (PRIVATE_KEY.test(content)) {
    findings.push(
      finding(
        path,
        "carries a private key block",
        "a key lifted into a template is committed, and a committed key is a rotated key at best",
        `take the key out of ${path} in the product, rotate it, and import again`,
      ),
    );
  }

  const vendor = VENDOR_TOKEN.exec(content);
  if (vendor !== null) {
    findings.push(
      finding(
        path,
        `carries what reads as a live credential (${vendor[0].slice(0, 8)}…)`,
        "the prefix identifies a vendor's own token format, so this is a key and not a coincidence",
        `replace the value in ${path} with a blank, rotate the key, and import again`,
      ),
    );
  }

  const jwt = JWT.exec(content);
  if (jwt !== null) {
    findings.push(
      finding(
        path,
        "carries a JSON Web Token",
        "a signed token is a credential until it expires, and a committed one is committed for ever",
        `replace the token in ${path} with a placeholder, and issue a fresh one`,
      ),
    );
  }

  for (const pattern of [QUOTED_ASSIGNMENT, ENV_ASSIGNMENT]) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const name = match[1] as string;
      const value = (match[3] ?? match[2]) as string;
      if (isPlaceholder(value)) continue;
      if (value.length < MIN_NAMED_ALONE && !looksGenerated(value)) continue;
      findings.push(
        finding(
          path,
          `assigns a value to ${name}`,
          "the name says the value is a credential, and it is filled in rather than left blank",
          `blank ${name} in ${path}, or move the value to a .env this template does not name`,
        ),
      );
    }
  }

  for (const match of content.matchAll(URL_CREDENTIAL)) {
    const value = match[1] as string;
    if (isPlaceholder(value)) continue;
    findings.push(
      finding(
        path,
        "carries a URL with a password in it",
        "a connection string with its credential is a credential, whatever the field is called",
        `replace the password in ${path} with a placeholder such as <password>`,
      ),
    );
  }

  for (const match of content.matchAll(LONG_LITERAL)) {
    const value = match[2] as string;
    if (isPlaceholder(value) || !looksGenerated(value)) continue;
    findings.push(
      finding(
        path,
        `carries a ${value.length}-character token-shaped literal`,
        "it is long, high-entropy and mixes cases and digits, which is what a generated key looks like and what prose does not",
        `if it is not a secret, shorten it or move it out of ${path}; if it is, rotate it`,
      ),
    );
  }

  return findings;
}
