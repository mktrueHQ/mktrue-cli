export function encodeProjectDir(path: string): string {
  return path.replace(/[^A-Za-z0-9-]/g, "-");
}
