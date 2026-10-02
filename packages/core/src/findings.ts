export const EXIT = {
  TRUE: 0,
  FINDINGS: 1,
  USAGE: 2,
  ENVIRONMENT: 3,
  DECISION: 4,
  NETWORK: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface Finding {
  readonly gate: string;
  readonly what: string;
  readonly why: string;
  readonly fix: string;
  readonly exit: ExitCode;
}

export function exitCodeFor(findings: readonly Finding[]): ExitCode {
  let code: ExitCode = EXIT.TRUE;
  for (const finding of findings) {
    if (finding.exit > code) code = finding.exit;
  }
  return code;
}
