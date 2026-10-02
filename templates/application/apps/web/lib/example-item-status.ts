import type { ExampleItemStatus } from "@__MKTRUE_NAME__/contracts";
import type { Messages } from "next-intl";

export type ExampleItemStatusKey = keyof Messages["exampleItems"]["status"];

export function statusKey(status: ExampleItemStatus): ExampleItemStatusKey {
  switch (status) {
    case "open":
      return "open";
    case "done":
      return "done";
  }
}
