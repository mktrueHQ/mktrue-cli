import { isCivilDate } from "../../shared/domain/civil-date";

export const EXAMPLE_ITEM_STATUSES = ["open", "done"] as const;

export type ExampleItemStatus = (typeof EXAMPLE_ITEM_STATUSES)[number];

export const EXAMPLE_ITEM_TITLE_MAX_LENGTH = 200;

export interface ExampleItemValidationIssue {
  readonly field: "title" | "status" | "createdOn";
  readonly reason: "empty" | "too_long" | "unsupported_status" | "not_a_civil_date";
}

export class InvalidExampleItemError extends Error {
  readonly issues: readonly ExampleItemValidationIssue[];

  constructor(issues: readonly ExampleItemValidationIssue[]) {
    super(
      `invalid example item: ${issues.map((issue) => `${issue.field}/${issue.reason}`).join(", ")}`,
    );
    this.name = "InvalidExampleItemError";
    this.issues = issues;
  }
}

export interface ExampleItemProps {
  readonly id: string;
  readonly title: string;
  readonly status: ExampleItemStatus;
  readonly createdOn: string;
}

export interface ExampleItemInput {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly createdOn: string;
}

export class ExampleItem {
  private constructor(private readonly props: ExampleItemProps) {}

  static create(input: ExampleItemInput): ExampleItem {
    const issues: ExampleItemValidationIssue[] = [];

    const title = input.title.trim();
    if (title.length === 0) issues.push({ field: "title", reason: "empty" });
    if (title.length > EXAMPLE_ITEM_TITLE_MAX_LENGTH) {
      issues.push({ field: "title", reason: "too_long" });
    }

    const status = EXAMPLE_ITEM_STATUSES.find((candidate) => candidate === input.status);
    if (status === undefined) issues.push({ field: "status", reason: "unsupported_status" });

    if (!isCivilDate(input.createdOn)) {
      issues.push({ field: "createdOn", reason: "not_a_civil_date" });
    }

    if (issues.length > 0 || status === undefined) {
      throw new InvalidExampleItemError(issues);
    }

    return new ExampleItem({ id: input.id, title, status, createdOn: input.createdOn });
  }

  get id(): string {
    return this.props.id;
  }

  get title(): string {
    return this.props.title;
  }

  get status(): ExampleItemStatus {
    return this.props.status;
  }

  get createdOn(): string {
    return this.props.createdOn;
  }

  toJSON(): ExampleItemProps {
    return { ...this.props };
  }
}
