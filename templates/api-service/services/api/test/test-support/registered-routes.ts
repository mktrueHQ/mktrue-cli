import type { FastifyInstance } from "fastify";

export interface RegisteredRoute {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  readonly path: string;
}

const ROUTE_LINE = /^(?<indent>[│ ]*)[├└]── (?<segment>\S+)(?: \((?<methods>[A-Z, ]+)\))?$/;
const INDENT_PER_LEVEL = 4;

export function registeredRoutes(server: FastifyInstance): readonly RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const segments: string[] = [];

  for (const line of server.printRoutes({ commonPrefix: false }).split("\n")) {
    const parsed = ROUTE_LINE.exec(line)?.groups;
    if (!parsed?.segment) continue;

    const depth = (parsed.indent?.length ?? 0) / INDENT_PER_LEVEL;
    segments.length = depth;
    segments.push(parsed.segment);

    if (!parsed.methods) continue;

    const path = segments.join("");
    for (const method of parsed.methods.split(", ")) {
      routes.push({ method: asMethod(method), path });
    }
  }

  return routes;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function asMethod(value: string): RegisteredRoute["method"] {
  const method = METHODS.find((candidate) => candidate === value);
  if (!method) {
    throw new Error(`unrecognised HTTP method in the route table: ${value}`);
  }
  return method;
}
