import { describe, expect, it } from "vitest";

import { serializeByUser } from "@api/app/serialize-by-user";
import type { SerializeByUser } from "@api/contexts/shared/application/ports";

const HIS = "user_owner_1";
const HERS = "user_other_2";

const PAIRS = 60;

const aTurnOfTheLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function readModifyWrite(cell: { value: number }): Promise<void> {
  const read = cell.value;
  await aTurnOfTheLoop();
  cell.value = read + 1;
}

async function pairsThatLostAnUpdate(serialize: SerializeByUser): Promise<number> {
  let lost = 0;
  for (let pair = 0; pair < PAIRS; pair += 1) {
    const cell = { value: 0 };
    await Promise.all([
      serialize(HIS, async () => readModifyWrite(cell)),
      serialize(HIS, async () => readModifyWrite(cell)),
    ]);
    if (cell.value !== 2) lost += 1;
  }
  return lost;
}

const PASS_THROUGH: SerializeByUser = async (_userId, run) => run();

describe("one person's read-modify-writes, one at a time", () => {
  it("loses nothing across sixty concurrent pairs", async () => {
    expect(await pairsThatLostAnUpdate(serializeByUser())).toBe(0);
  });

  it("loses every pair when the same runs are not serialized", async () => {
    expect(await pairsThatLostAnUpdate(PASS_THROUGH)).toBe(PAIRS);
  });

  it("does not hold one user's run behind another's", async () => {
    const serialize = serializeByUser();
    const trail: string[] = [];
    let releaseHis = (): void => undefined;
    const his = new Promise<void>((resolve) => {
      releaseHis = resolve;
    });

    const running = Promise.all([
      serialize(HIS, async () => {
        trail.push("his:start");
        await his;
        trail.push("his:end");
      }),
      serialize(HERS, async () => {
        trail.push("hers:start");
        return Promise.resolve();
      }),
    ]);

    await aTurnOfTheLoop();
    expect(trail).toEqual(["his:start", "hers:start"]);
    releaseHis();
    await running;
  });

  it("runs every queued write rather than absorbing one into another", async () => {
    const serialize = serializeByUser();
    const runs: number[] = [];

    await Promise.all(
      [1, 2, 3].map(async (at) =>
        serialize(HIS, async () => {
          await aTurnOfTheLoop();
          runs.push(at);
        }),
      ),
    );

    expect(runs.toSorted()).toEqual([1, 2, 3]);
  });

  it("answers what the run answered", async () => {
    await expect(serializeByUser()(HIS, async () => Promise.resolve("written"))).resolves.toBe(
      "written",
    );
  });

  it("reports a failure to its own caller and still runs the next one", async () => {
    const serialize = serializeByUser();

    await expect(
      serialize(HIS, async () => Promise.reject(new Error("mongo went away"))),
    ).rejects.toThrow("mongo went away");
    await expect(serialize(HIS, async () => Promise.resolve("written"))).resolves.toBe("written");
  });

  it("runs a write queued behind one that threw", async () => {
    const serialize = serializeByUser();
    const failing = serialize(HIS, async () => {
      await aTurnOfTheLoop();
      return Promise.reject(new Error("mongo went away"));
    });
    const queued = serialize(HIS, async () => Promise.resolve("written"));

    await expect(failing).rejects.toThrow("mongo went away");
    await expect(queued).resolves.toBe("written");
  });
});
