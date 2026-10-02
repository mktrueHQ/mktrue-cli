import { InvalidAccessRequest } from "./errors";

/** What __MKTRUE_OWNER__ does with a stored request. `approved` **records** a hand-edit; it never causes one. */
export type AccessRequestStatus = "new" | "approved" | "declined";

export interface AccessRequestFields {
  readonly email: string;
  readonly note?: string;
}

/**
 * Someone asking to be added to __MKTRUE_TITLE__'s whitelist. Never "signup", never "lead" (CLAUDE.md §9).
 *
 * Framework-free by construction — no mongoose, no zod, no Fastify. The zod schema at the edge and
 * this constructor validate the same shape on purpose: the schema is the HTTP contract, this is the
 * invariant, and the domain must still hold if a second caller ever arrives that is not a route.
 */
export class AccessRequest {
  private constructor(
    readonly email: string,
    readonly note: string | undefined,
  ) {}

  static create(fields: AccessRequestFields): AccessRequest {
    const email = fields.email.trim().toLowerCase();

    // Deliberately permissive about SHAPE: one `@`, something either side, a dot in the domain.
    // A stricter pattern rejects real addresses, and the actual proof of validity is that a code
    // sent to it comes back — which is the whole design.
    //
    // **Strict about control characters, though, and that part is load-bearing.** This address is
    // interpolated into a mail Subject (`email-templates.ts`), so a newline in it is header
    // injection — an attacker appends `\nBcc:` and the provider sends copies wherever they like.
    // `\s` alone was not enough: it excludes CR and LF but NOT NUL, so `a@b.co\u0000` passed
    // validation and would have reached both the header and the mailbox row. Found by the M2
    // slice-2.8 audit. Every C0 control and DEL is refused explicitly rather than left to a
    // character class that happens to cover most of them.
    if (
      email.length > 254 ||
      // eslint-disable-next-line no-control-regex -- the point of this check is control characters
      /[\u0000-\u001f\u007f]/.test(email) ||
      !/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)
    ) {
      throw new InvalidAccessRequest("email");
    }

    const note = fields.note?.trim();
    if (note !== undefined) {
      // The note reaches the mail BODY, not a header, and is escaped at every HTML call site — so
      // this is defence in depth. Newline and tab stay legal because it is free text a person
      // writes; everything else in C0, NUL included, has no business in it.
      // eslint-disable-next-line no-control-regex -- as above
      if (note.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) {
        throw new InvalidAccessRequest("note");
      }
    }

    return new AccessRequest(email, note === "" ? undefined : note);
  }

  /** The shape carried inside the signed token and written to the mailbox. */
  toJSON(): AccessRequestFields {
    return this.note === undefined ? { email: this.email } : { email: this.email, note: this.note };
  }
}
