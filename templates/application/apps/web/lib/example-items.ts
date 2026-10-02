import "server-only";

import {
  exampleItemDtoSchema,
  type ExampleItemDto,
  type ExampleItemStatus,
} from "@__MKTRUE_NAME__/contracts";

import { apiGet, type ApiResult } from "./api";

const exampleItemListSchema = exampleItemDtoSchema.array();

export async function listExampleItems(
  status: ExampleItemStatus | undefined,
): Promise<ApiResult<readonly ExampleItemDto[]>> {
  const query = status === undefined ? "" : `?${new URLSearchParams({ status }).toString()}`;
  return await apiGet({ path: `/example-items${query}`, expect: exampleItemListSchema });
}
