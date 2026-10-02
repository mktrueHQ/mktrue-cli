import { isCivilDate } from "../../shared/domain/civil-date";

export const EXAMPLE_NOTE_TEXT_MAX_LENGTH = 2000;

export interface ExampleNoteValidationIssue {
  readonly field: "text" | "writtenOn";
  readonly reason: "empty" | "too_long" | "not_a_civil_date";
}

export class InvalidExampleNoteError extends Error {
  readonly issues: readonly ExampleNoteValidationIssue[];

  constructor(issues: readonly ExampleNoteValidationIssue[]) {
    super(
      `invalid example note: ${issues.map((issue) => `${issue.field}/${issue.reason}`).join(", ")}`,
    );
    this.name = "InvalidExampleNoteError";
    this.issues = issues;
  }
}

export interface ExampleNoteProps {
  readonly id: string;
  readonly itemId: string;
  readonly text: string;
  readonly writtenOn: string;
}

export interface ExampleNoteInput {
  readonly id: string;
  readonly itemId: string;
  readonly text: string;
  readonly writtenOn: string;
}

export class ExampleNote {
  private constructor(private readonly props: ExampleNoteProps) {}

  static create(input: ExampleNoteInput): ExampleNote {
    const issues: ExampleNoteValidationIssue[] = [];

    const text = input.text.trim();
    if (text.length === 0) issues.push({ field: "text", reason: "empty" });
    if (text.length > EXAMPLE_NOTE_TEXT_MAX_LENGTH) {
      issues.push({ field: "text", reason: "too_long" });
    }
    if (!isCivilDate(input.writtenOn)) {
      issues.push({ field: "writtenOn", reason: "not_a_civil_date" });
    }

    if (issues.length > 0) {
      throw new InvalidExampleNoteError(issues);
    }

    return new ExampleNote({
      id: input.id,
      itemId: input.itemId,
      text,
      writtenOn: input.writtenOn,
    });
  }

  get id(): string {
    return this.props.id;
  }

  get itemId(): string {
    return this.props.itemId;
  }

  get text(): string {
    return this.props.text;
  }

  get writtenOn(): string {
    return this.props.writtenOn;
  }

  toJSON(): ExampleNoteProps {
    return { ...this.props };
  }
}
