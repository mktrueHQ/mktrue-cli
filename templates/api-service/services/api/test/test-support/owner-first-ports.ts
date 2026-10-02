export type ExactlyString<T> = [T] extends [string] ? ([string] extends [T] ? true : false) : false;

export type UnscopedMethods<Port> = {
  [Method in keyof Port]: Port[Method] extends (...args: never[]) => unknown
    ? ExactlyString<Parameters<Port[Method]>[0]> extends true
      ? never
      : Method
    : Method;
}[keyof Port];

export type AssertNever<T extends never> = T;

export function methodsOf(prototype: object): [string, (...args: never[]) => unknown][] {
  return Object.entries(Object.getOwnPropertyDescriptors(prototype))
    .filter(
      ([name, descriptor]) => name !== "constructor" && typeof descriptor.value === "function",
    )
    .map(([name, descriptor]) => [name, descriptor.value as (...args: never[]) => unknown]);
}

export function firstParameterName(fn: (...args: never[]) => unknown): string {
  const parameters = /\(([^)]*)\)/.exec(fn.toString())?.[1] ?? "";
  return (parameters.split(",")[0] ?? "").split("=")[0]?.trim() ?? "";
}

export function declaredMembers(source: string, port: string): [string, string][] {
  const start = source.search(new RegExp(`^export interface ${port}\\b[^{]*\\{`, "m"));
  if (start === -1) return [];
  const end = source.indexOf("\n}", start);
  const body = source.slice(source.indexOf("{", start) + 1, end === -1 ? undefined : end);

  return [
    ...body.matchAll(/^\s*(?:readonly\s+)?(\w+)\??\s*(?::\s*)?(?:<[^>]*>\s*)?\(([^)]*)\)/gm),
  ].map((match) => [
    match[1] ?? "",
    (match[2] ?? "").split(",")[0]?.split(/[?:=]/)[0]?.trim() ?? "",
  ]);
}
