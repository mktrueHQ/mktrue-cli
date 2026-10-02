import type { ApiFailure, UnavailableReason } from "./api";

export type FailureState =
  | "forbidden"
  | "unauthenticated"
  | "notFound"
  | "invalid"
  | "conflict"
  | `unavailable.${UnavailableReason}`;

export interface FailureCopy {
  readonly title: `${FailureState}.title`;
  readonly detail: `${FailureState}.detail`;
  readonly needsDifferentSession: boolean;
}

export function apiFailureCopy(failure: ApiFailure): FailureCopy {
  switch (failure.status) {
    case "forbidden":
    case "unauthenticated":
      return copyOf(failure.status, true);
    case "notFound":
    case "invalid":
    case "conflict":
      return copyOf(failure.status, false);
    case "unavailable":
      return copyOf(`unavailable.${failure.reason}`, false);
  }
}

function copyOf(state: FailureState, needsDifferentSession: boolean): FailureCopy {
  return { title: `${state}.title`, detail: `${state}.detail`, needsDifferentSession };
}

export const NO_ACCESS_PATH = "/no-access";

export function isNoAccess(failure: ApiFailure): boolean {
  return failure.status === "forbidden";
}
