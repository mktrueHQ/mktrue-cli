import type { AccessRequest } from "../domain/access-request";

/** Minimal escaping for the two values that reach HTML: the address, and the requester's note. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Plain template functions rather than a React Email package.
 *
 * `docs/design/m2-the-mailbox.md` scoped a `packages/emails` mirroring the portfolio's. Two emails
 * with no shared layout do not earn a package or the two dependencies it would add, and CLAUDE.md
 * §4.8 wants __MKTRUE_OWNER__'s yes before a dependency lands. If a third email ever appears, extract then.
 */
const TITLE = "__MKTRUE_TITLE__";

export function verificationCodeEmail(code: string): {
  subject: string;
  html: string;
  text: string;
} {
  const text = [
    `Your ${TITLE} access code is ${code}.`,
    "",
    "It expires in 15 minutes. If you did not ask for it, just ignore this message. Nothing has been stored.",
  ].join("\n");

  return {
    subject: `${code} is your ${TITLE} access code`,
    text,
    html: `<div style="font-family:system-ui,sans-serif;line-height:1.5;color:#e6e8eb;background:#0b0d10;padding:24px">
  <p>Your ${escapeHtml(TITLE)} access code is:</p>
  <p style="font:600 32px/1 ui-monospace,monospace;letter-spacing:.2em;color:#818cf8">${escapeHtml(code)}</p>
  <p style="color:#9aa3ad">It expires in 15 minutes. If you did not ask for it, just ignore this message. Nothing has been stored.</p>
</div>`,
  };
}

/**
 * The delivered request. Its whole job is to make the hand-edit one copy-paste, so the
 * address sits alone on its own line in mono. There is deliberately **no approve button**: nothing
 * in this repo can grant access, and a button implying otherwise is exactly an earlier decision's failure mode.
 */
export function deliveredAccessRequestEmail(
  request: AccessRequest,
  at: Date,
): { subject: string; html: string; text: string } {
  const note = request.note ?? "(no note)";
  const stamp = at.toISOString();

  const text = [
    "A verified access request.",
    "",
    request.email,
    "",
    `Note: ${note}`,
    `Verified at: ${stamp}`,
    "",
    "Verified means they own that address. It does not mean approved: add it to ALLOWED_USER_IDS by hand if you want them in.",
  ].join("\n");

  return {
    subject: `Access request: ${request.email}`,
    text,
    html: `<div style="font-family:system-ui,sans-serif;line-height:1.5;color:#e6e8eb;background:#0b0d10;padding:24px">
  <p style="color:#9aa3ad">A verified access request.</p>
  <p style="font:400 20px/1.4 ui-monospace,monospace;color:#818cf8">${escapeHtml(request.email)}</p>
  <p><strong>Note:</strong> ${escapeHtml(note)}</p>
  <p style="color:#9aa3ad">Verified at ${escapeHtml(stamp)}</p>
  <p style="color:#9aa3ad">Verified means they own that address. It does <strong>not</strong> mean approved: add it to the whitelist by hand if you want them in.</p>
</div>`,
  };
}
