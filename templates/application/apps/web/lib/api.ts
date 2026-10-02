import "server-only";

import { apiErrorSchema } from "@__MKTRUE_NAME__/contracts";

import { config } from "./config";
import { fetchFailureTrail } from "./fetch-failure";
import { ownerToken } from "./owner-token";

export type ApiResult<T> = { readonly status: "ok"; readonly data: T } | ApiFailure;

export type ApiFailure =
  | { readonly status: "forbidden" }
  | { readonly status: "unauthenticated" }
  | { readonly status: "notFound" }
  | { readonly status: "invalid" }
  | { readonly status: "conflict" }
  | { readonly status: "unavailable"; readonly reason: UnavailableReason };

export type UnavailableReason = "auth" | "storage" | "api";

export interface BodyParser<T> {
  safeParse(
    value: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

interface ApiRequest<T> {
  readonly path: string;
  readonly expect: BodyParser<T>;
  readonly signal?: AbortSignal;
}

export async function apiGet<T>(request: ApiRequest<T>): Promise<ApiResult<T>> {
  return await send({ ...request, method: "GET" });
}

export async function apiSend<T>(
  request: ApiRequest<T> & {
    readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
    readonly body?: unknown;
  },
): Promise<ApiResult<T>> {
  return await send(request);
}

async function send<T>(
  request: ApiRequest<T> & { readonly method: string; readonly body?: unknown },
): Promise<ApiResult<T>> {
  const { method, path, body, expect, signal } = request;
  const where = `${method} ${path.split("?")[0]}`;

  const token = await ownerToken();
  if (token === null) return { status: "unauthenticated" };

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      cache: "no-store",
      ...(signal === undefined ? {} : { signal }),
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    console.error(`api: ${where} could not reach the API (${fetchFailureTrail(error)})`);
    return { status: "unavailable", reason: "api" };
  }

  if (!response.ok) return await classifyRefusal(response, where);

  let payload: unknown;
  try {
    const text = await response.text();
    payload = text === "" ? undefined : (JSON.parse(text) as unknown);
  } catch {
    console.error(`api: ${where} answered ${response.status} with unreadable JSON`);
    return { status: "unavailable", reason: "api" };
  }

  const parsed = expect.safeParse(payload);
  if (!parsed.success) {
    console.error(`api: ${where} answered a body its contract refuses`);
    return { status: "unavailable", reason: "api" };
  }
  return { status: "ok", data: parsed.data };
}

async function classifyRefusal(response: Response, where: string): Promise<ApiFailure> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    console.error(`api: ${where} refused with ${response.status}, no API error envelope`);
    return { status: "unavailable", reason: "api" };
  }

  const { code } = parsed.data.error;
  console.error(`api: ${where} refused with ${response.status} (${code})`);

  switch (code) {
    case "forbidden":
      return { status: "forbidden" };
    case "unauthenticated":
      return { status: "unauthenticated" };
    case "not_found":
      return { status: "notFound" };
    case "invalid_request":
      return { status: "invalid" };
    case "conflict":
      return { status: "conflict" };
    case "auth_unavailable":
      return { status: "unavailable", reason: "auth" };
    case "storage_unavailable":
      return { status: "unavailable", reason: "storage" };
    case "internal":
      return { status: "unavailable", reason: "api" };
  }
}
