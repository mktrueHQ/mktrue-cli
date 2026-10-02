import type { SendBudget } from "../application/ports";
import { SendBudgetModel } from "./send-budget-model";

export const mongooseSendBudget: SendBudget = {
  /**
   * `$inc` with `upsert` — one atomic round trip that both counts and reports.
   *
   * Mongo applies `$inc` server-side, so two concurrent callers cannot both read 39 and both
   * decide they are under a limit of 40. Comparing the *returned* value is what makes the ceiling
   * real rather than advisory.
   */
  async reserve(day, limit, cost) {
    try {
      const doc = await SendBudgetModel.findOneAndUpdate(
        { day },
        { $inc: { count: cost } },
        // The same bound the claim carries. Without it a slow-but-connected Mongo serves this write
        // while the claim gives up and fails open — `start` issuing tokens with replay protection
        // off, which is the exact inverse of what an earlier decision argues for.
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, maxTimeMS: 2_000 },
      ).lean();

      // A failed upsert is not a licence to send. Fail closed (CLAUDE.md §4.5): if the ceiling
      // cannot be enforced, refuse rather than assume there is room.
      if (doc === null) return false;
      return doc.count <= limit;
    } catch {
      // **A thrown driver error is the same answer as a failed upsert: no.** Letting it propagate
      // sent Fastify's default handler to the client with the driver's message in it, naming
      // internal collections and hosts, as a 500 — where this repo's answer to "the mail cannot be
      // sent" is a 503 carrying a fixed string. The error is swallowed rather than logged because
      // this seam has no logger and the message is exactly what must not be written down.
      return false;
    }
  },
};

/**
 * The fallback when no database is configured.
 *
 * Persistence is best-effort in this service, so the API boots without Mongo — but a budget that
 * cannot be recorded is a budget that is not enforced. In-process, per-day, and honest about what
 * it is: it resets on restart, which is exactly why it is not the production adapter.
 */
export function createInMemorySendBudget(): SendBudget {
  let day = "";
  let count = 0;

  return {
    async reserve(forDay, limit, cost) {
      if (forDay !== day) {
        day = forDay;
        count = 0;
      }
      count += cost;
      return count <= limit;
    },
  };
}
