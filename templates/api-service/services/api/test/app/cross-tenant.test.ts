import type { FastifyInstance, InjectOptions } from "fastify";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildServer, PUBLIC_ENDPOINTS } from "@api/app/server";
import { ExampleItemModel } from "@api/contexts/example/infrastructure/example-item-model";
import { ExampleNoteModel } from "@api/contexts/example/infrastructure/example-note-model";
import { LOCALES } from "@api/contexts/profile/domain/user-profile";
import { UserProfileModel } from "@api/contexts/profile/infrastructure/user-profile-model";
import { toIsoDate } from "@api/contexts/shared/domain/civil-date";
import { connectMongo, disconnectMongo } from "@api/contexts/shared/infrastructure/mongo";

import {
  AUTHORIZED,
  AUTHORIZED_AS_OTHER,
  FIXED_ZONE,
  OTHER_USER,
  OWNER,
  serverAdmittingBoth,
} from "../test-support/owner-server";
import { registeredRoutes } from "../test-support/registered-routes";

const HIS_TITLE = "his item, which only he may read";
const HIS_SECOND_TITLE = "his second item";
const HIS_NOTE = "his note, filed against his own item";
const HER_TITLE = "her item, present so that isolation is asserted with both tenants' rows";

const PROBE_TITLE = "an item written during the probe";
const PROBE_NOTE = "a note written during the probe";

const FIRST_LOCALE = LOCALES[0];

const HIS_ZONE = "Pacific/Kiritimati";
const HER_ZONE = "Pacific/Pago_Pago";

interface Seeded {
  readonly itemId: string;
}

let replSet: MongoMemoryReplSet;
let server: FastifyInstance;

async function seedRows(): Promise<Seeded> {
  const item = await ExampleItemModel.create({
    userId: OWNER,
    title: HIS_TITLE,
    status: "open",
    createdOn: "2026-01-05",
  });
  await ExampleItemModel.create({
    userId: OWNER,
    title: HIS_SECOND_TITLE,
    status: "open",
    createdOn: "2026-01-06",
  });
  await ExampleNoteModel.create({
    userId: OWNER,
    itemId: item._id,
    text: HIS_NOTE,
    writtenOn: "2026-01-05",
  });
  await ExampleItemModel.create({
    userId: OTHER_USER,
    title: HER_TITLE,
    status: "open",
    createdOn: "2026-01-05",
  });
  await UserProfileModel.create({ userId: OWNER, locale: FIRST_LOCALE, timeZone: HIS_ZONE });
  return { itemId: String(item._id) };
}

async function hisStoredRows(): Promise<string> {
  const [items, notes, profiles] = await Promise.all([
    ExampleItemModel.collection.find({ userId: OWNER }).sort({ _id: 1 }).toArray(),
    ExampleNoteModel.collection.find({ userId: OWNER }).sort({ _id: 1 }).toArray(),
    UserProfileModel.collection.find({ userId: OWNER }).sort({ _id: 1 }).toArray(),
  ]);
  return JSON.stringify({ items, notes, profiles });
}

interface Probe {
  readonly request: (seeded: Seeded) => InjectOptions;
  readonly ownerStatus: number;
  readonly strangerStatus: number;
  readonly ownerBodyNames?: string;
  readonly comparesAnswers?: (stranger: string, owner: string) => void;
}

const countsIn = (body: string) =>
  (JSON.parse(body) as { byStatus: { status: string; count: number }[] }).byStatus;

const PROBES: Readonly<Record<string, Probe>> = {
  "GET /example-items": {
    request: () => ({ method: "GET", url: "/example-items" }),
    ownerStatus: 200,
    strangerStatus: 200,
    ownerBodyNames: HIS_TITLE,
  },
  "HEAD /example-items": {
    request: () => ({ method: "HEAD", url: "/example-items" }),
    ownerStatus: 200,
    strangerStatus: 200,
  },
  "POST /example-items": {
    request: () => ({ method: "POST", url: "/example-items", payload: { title: PROBE_TITLE } }),
    ownerStatus: 201,
    strangerStatus: 201,
  },
  "PATCH /example-items/:id": {
    request: ({ itemId }) => ({
      method: "PATCH",
      url: `/example-items/${itemId}`,
      payload: { status: "done" },
    }),
    ownerStatus: 200,
    strangerStatus: 404,
    ownerBodyNames: HIS_TITLE,
  },
  "GET /example-items/:id/notes": {
    request: ({ itemId }) => ({ method: "GET", url: `/example-items/${itemId}/notes` }),
    ownerStatus: 200,
    strangerStatus: 404,
    ownerBodyNames: HIS_NOTE,
  },
  "HEAD /example-items/:id/notes": {
    request: ({ itemId }) => ({ method: "HEAD", url: `/example-items/${itemId}/notes` }),
    ownerStatus: 200,
    strangerStatus: 404,
  },
  "POST /example-items/:id/notes": {
    request: ({ itemId }) => ({
      method: "POST",
      url: `/example-items/${itemId}/notes`,
      payload: { text: PROBE_NOTE },
    }),
    ownerStatus: 201,
    strangerStatus: 404,
  },
  "GET /stats/example-items": {
    request: () => ({ method: "GET", url: "/stats/example-items" }),
    ownerStatus: 200,
    strangerStatus: 200,
    comparesAnswers: (stranger, owner) => {
      expect(countsIn(stranger)).toEqual([
        { status: "open", count: 1 },
        { status: "done", count: 0 },
      ]);
      expect(countsIn(owner)).toEqual([
        { status: "open", count: 2 },
        { status: "done", count: 0 },
      ]);
      expect((JSON.parse(owner) as { timezone: string }).timezone).toBe(HIS_ZONE);
      expect((JSON.parse(stranger) as { timezone: string }).timezone).toBe(FIXED_ZONE);
    },
  },
  "HEAD /stats/example-items": {
    request: () => ({ method: "HEAD", url: "/stats/example-items" }),
    ownerStatus: 200,
    strangerStatus: 200,
  },
  "GET /profile": {
    request: () => ({ method: "GET", url: "/profile" }),
    ownerStatus: 200,
    strangerStatus: 200,
    comparesAnswers: (stranger, owner) => {
      expect(JSON.parse(stranger)).toEqual({});
      expect(JSON.parse(owner)).toEqual({ locale: FIRST_LOCALE, timeZone: HIS_ZONE });
    },
  },
  "HEAD /profile": {
    request: () => ({ method: "HEAD", url: "/profile" }),
    ownerStatus: 200,
    strangerStatus: 200,
  },
  "PATCH /profile": {
    request: () => ({ method: "PATCH", url: "/profile", payload: { locale: FIRST_LOCALE } }),
    ownerStatus: 200,
    strangerStatus: 200,
  },
  "GET /me": {
    request: () => ({ method: "GET", url: "/me" }),
    ownerStatus: 200,
    strangerStatus: 200,
    comparesAnswers: (stranger, owner) => {
      expect(JSON.parse(stranger)).toEqual({ userId: OTHER_USER });
      expect(JSON.parse(owner)).toEqual({ userId: OWNER });
    },
  },
  "HEAD /me": {
    request: () => ({ method: "HEAD", url: "/me" }),
    ownerStatus: 200,
    strangerStatus: 200,
  },
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await connectMongo({ uri: replSet.getUri(), dbName: "cross-tenant" });
  await Promise.all([ExampleItemModel.init(), ExampleNoteModel.init(), UserProfileModel.init()]);
  server = serverAdmittingBoth();
});

afterEach(async () => {
  await Promise.all([
    ExampleItemModel.collection.deleteMany({}),
    ExampleNoteModel.collection.deleteMany({}),
    UserProfileModel.collection.deleteMany({}),
  ]);
});

afterAll(async () => {
  await server.close();
  await disconnectMongo();
  await replSet.stop();
});

const gatedEndpoints = async (walk: FastifyInstance): Promise<string[]> => {
  await walk.ready();
  return registeredRoutes(walk)
    .map((route) => `${route.method} ${route.path}`)
    .filter((endpoint) => !PUBLIC_ENDPOINTS.has(endpoint));
};

describe("the cross-tenant probe map", () => {
  it("covers every gated route the service registers", async () => {
    const walk = buildServer();

    expect(Object.keys(PROBES).toSorted()).toEqual((await gatedEndpoints(walk)).toSorted());
    await walk.close();
  });

  it("names a route registered with no probe, rather than passing over it", async () => {
    const walk = buildServer();
    walk.get("/an-unprobed-route", () => ({}));

    const uncovered = (await gatedEndpoints(walk)).filter((endpoint) => !(endpoint in PROBES));

    expect(uncovered.toSorted()).toEqual(["GET /an-unprobed-route", "HEAD /an-unprobed-route"]);
    await walk.close();
  });
});

describe.each(Object.entries(PROBES))("%s", (_endpoint, probe) => {
  it("refuses the stranger, leaves his rows untouched, and succeeds for him", async () => {
    const seeded = await seedRows();
    const before = await hisStoredRows();
    expect(before).toContain(HIS_TITLE);
    expect(before).toContain(HIS_NOTE);

    const hers = await server.inject({ ...probe.request(seeded), headers: AUTHORIZED_AS_OTHER });

    expect(hers.statusCode).toBe(probe.strangerStatus);
    for (const secret of [HIS_TITLE, HIS_SECOND_TITLE, HIS_NOTE, seeded.itemId, OWNER]) {
      expect(hers.body).not.toContain(secret);
    }
    expect(await hisStoredRows()).toBe(before);

    const his = await server.inject({ ...probe.request(seeded), headers: AUTHORIZED });

    expect(his.statusCode).toBe(probe.ownerStatus);
    if (probe.ownerBodyNames !== undefined) expect(his.body).toContain(probe.ownerBodyNames);
    probe.comparesAnswers?.(hers.body, his.body);
  });

  it("ignores an owner id the stranger supplies herself", async () => {
    const seeded = await seedRows();
    const before = await hisStoredRows();
    const request = probe.request(seeded);
    const separator = String(request.url).includes("?") ? "&" : "?";
    const carriesBody = request.method !== "GET" && request.method !== "HEAD";

    const hers = await server.inject({
      ...request,
      url: `${String(request.url)}${separator}userId=${OWNER}`,
      ...(carriesBody
        ? { payload: { ...(request.payload as Record<string, unknown>), userId: OWNER } }
        : {}),
      headers: AUTHORIZED_AS_OTHER,
    });

    expect(hers.statusCode).toBe(probe.strangerStatus);
    for (const secret of [HIS_TITLE, HIS_SECOND_TITLE, HIS_NOTE, seeded.itemId]) {
      expect(hers.body).not.toContain(secret);
    }
    expect(await hisStoredRows()).toBe(before);
  });
});

describe("what each principal's own writes hold", () => {
  it("files her item under her, and his list does not grow", async () => {
    await seedRows();

    const created = await server.inject({
      method: "POST",
      url: "/example-items",
      payload: { title: PROBE_TITLE },
      headers: AUTHORIZED_AS_OTHER,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty("userId");

    const stored = await ExampleItemModel.collection.findOne({ title: PROBE_TITLE });
    expect(stored?.userId).toBe(OTHER_USER);

    const his = await server.inject({ method: "GET", url: "/example-items", headers: AUTHORIZED });
    expect(his.body).not.toContain(PROBE_TITLE);
  });

  it("dates each principal's item in that principal's own zone", async () => {
    await seedRows();
    const chosen = await server.inject({
      method: "PATCH",
      url: "/profile",
      payload: { timeZone: HER_ZONE },
      headers: AUTHORIZED_AS_OTHER,
    });
    expect(chosen.statusCode).toBe(200);

    const createdOn = async (headers: typeof AUTHORIZED, zone: string) => {
      const before = toIsoDate(new Date(), zone);
      const response = await server.inject({
        method: "POST",
        url: "/example-items",
        payload: { title: PROBE_TITLE },
        headers,
      });
      const after = toIsoDate(new Date(), zone);
      expect(response.statusCode).toBe(201);
      const { createdOn: date } = response.json<{ createdOn: string }>();
      expect([before, after]).toContain(date);
      return date;
    };

    const his = await createdOn(AUTHORIZED, HIS_ZONE);
    const hers = await createdOn(AUTHORIZED_AS_OTHER, HER_ZONE);
    expect(hers).not.toBe(his);
  });
});
