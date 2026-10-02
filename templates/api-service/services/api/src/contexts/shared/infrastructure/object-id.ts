const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export function isObjectIdString(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value);
}
