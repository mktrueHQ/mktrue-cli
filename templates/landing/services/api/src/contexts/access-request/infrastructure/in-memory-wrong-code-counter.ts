import type { WrongCodeCounter } from "../application/ports";

/**
 * The count of wrong codes, in this process: the service runs as one container. A restart forgets
 * it, and a second container would keep a count of its own.
 *
 * Bounded by `capacity` tokens. A count is dropped once its token has expired; while the counter is
 * still full after that, a token it does not hold is refused rather than guessed at uncounted.
 */
export function createInMemoryWrongCodeCounter(capacity: number): WrongCodeCounter {
  const counts = new Map<string, { wrong: number; expiresAt: number }>();

  function dropExpired(now: number): void {
    for (const [digest, entry] of counts) {
      if (entry.expiresAt <= now) counts.delete(digest);
    }
  }

  return {
    isSpent(tokenDigest, limit, now) {
      const entry = counts.get(tokenDigest);
      if (entry !== undefined) return entry.wrong >= limit;

      if (counts.size >= capacity) dropExpired(now);
      return counts.size >= capacity;
    },
    record(tokenDigest, expiresAt) {
      const wrong = (counts.get(tokenDigest)?.wrong ?? 0) + 1;
      counts.set(tokenDigest, { wrong, expiresAt });
    },
  };
}
