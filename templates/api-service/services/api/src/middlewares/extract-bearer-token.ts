const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export function extractBearerToken(header: string | undefined): string | undefined {
  return header ? BEARER_PATTERN.exec(header)?.[1] : undefined;
}
