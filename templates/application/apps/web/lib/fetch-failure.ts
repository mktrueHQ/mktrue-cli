const NAME = /^[A-Za-z]{1,40}$/;
const CODE = /^[A-Z0-9_]{1,40}$/;

export const UNKNOWN_FAILURE = "unknown failure";

export function fetchFailureTrail(error: unknown): string {
  try {
    if (!isObject(error)) return UNKNOWN_FAILURE;
    const name = tokenOf(error.name, NAME);
    if (name === undefined) return UNKNOWN_FAILURE;
    const code =
      tokenOf(error.code, CODE) ??
      (isObject(error.cause) ? tokenOf(error.cause.code, CODE) : undefined);
    return code === undefined ? name : `${name}, ${code}`;
  } catch {
    return UNKNOWN_FAILURE;
  }
}

function tokenOf(value: unknown, shape: RegExp): string | undefined {
  return typeof value === "string" && shape.test(value) ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
