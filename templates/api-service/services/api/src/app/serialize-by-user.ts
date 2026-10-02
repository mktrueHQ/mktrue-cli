import type { SerializeByUser } from "../contexts/shared/application/ports";

export function serializeByUser(): SerializeByUser {
  const draining = new Map<string, Promise<unknown>>();

  return async <T>(userId: string, run: () => Promise<T>): Promise<T> => {
    // Run on either outcome: a predecessor's failure belongs to its own caller, not to the queue.
    const queued = (draining.get(userId) ?? Promise.resolve()).then(run, run);
    const settled = queued.then(
      () => undefined,
      () => undefined,
    );
    draining.set(userId, settled);

    try {
      return await queued;
    } finally {
      // Only when nothing queued behind this run, or the next arrival would start beside it.
      if (draining.get(userId) === settled) draining.delete(userId);
    }
  };
}
