import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/app/config";
import { buildServer } from "../../src/app/server";
import { bucketOf, limit, RATE_LIMITS } from "../../src/middlewares/rate-limit";
import { fakeMailer, fakeRepository } from "../test-support/fakes";

describe("the limits a client meets", () => {
  it("are five starts and twenty verifications an hour", () => {
    expect(RATE_LIMITS).toEqual({
      sendsMail: { max: 5, timeWindow: "1 hour" },
      verifiesCode: { max: 20, timeWindow: "1 hour" },
    });
    expect(limit("sendsMail")).toEqual({ rateLimit: { max: 5, timeWindow: "1 hour" } });
    expect(limit("verifiesCode")).toEqual({ rateLimit: { max: 20, timeWindow: "1 hour" } });
  });
});

describe("the bucket an address counts in", () => {
  it.each(["203.0.113.7", "10.0.0.2", "255.255.255.255"])("keeps IPv4 %s whole", (address) => {
    expect(bucketOf(address)).toBe(address);
  });

  it.each([
    ["2001:db8:85a3:7::1", "2001:db8:85a3:7::/64"],
    ["2001:db8:85a3:7:ffff:ffff:ffff:ffff", "2001:db8:85a3:7::/64"],
    ["2001:0DB8:85A3:0007:0000:8a2e:0370:7334", "2001:db8:85a3:7::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001:db8:0:0:1::", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["::", "0:0:0:0::/64"],
    ["2001:db8:1:2:3:4:192.0.2.1", "2001:db8:1:2::/64"],
    ["64:ff9b::192.0.2.1", "64:ff9b:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::fffe:203.0.113.7", "0:0:0:0::/64"],
    ["0:0:0:0:1:ffff:cb00:7107", "0:0:0:0::/64"],
    ["1::ffff:203.0.113.7", "1:0:0:0::/64"],
    ["::1:0:203.0.113.7", "0:0:0:0::/64"],
  ])("counts %s in %s", (address, bucket) => {
    expect(bucketOf(address)).toBe(bucket);
  });

  it("tells two /64 apart, down to the last bit of the prefix", () => {
    expect(bucketOf("2001:db8:85a3:7::1")).not.toBe(bucketOf("2001:db8:85a3:6::1"));
    expect(bucketOf("2001:db8:85a3:7::1")).not.toBe(bucketOf("2001:db8:85a3:17::1"));
  });

  it.each([
    "::ffff:203.0.113.7",
    "::FFFF:203.0.113.7",
    "::ffff:cb00:7107",
    "0:0:0:0:0:ffff:cb00:7107",
    "0000:0000:0000:0000:0000:ffff:cb00:7107",
    "0:0:0:0:0:FFFF:203.0.113.7",
    "::203.0.113.7",
    "::cb00:7107",
    "0:0:0:0:0:0:203.0.113.7",
    "::ffff:203.0.113.7%eth0",
  ])("counts %s as the IPv4 address it carries", (address) => {
    expect(bucketOf(address)).toBe("203.0.113.7");
  });

  it("tells two carried IPv4 addresses apart, down to the last bit", () => {
    expect(bucketOf("::ffff:203.0.113.8")).toBe("203.0.113.8");
    expect(bucketOf("::ffff:cb00:7108")).toBe("203.0.113.8");
    expect(bucketOf("::0.0.0.2")).toBe("0.0.0.2");
    expect(bucketOf("::ffff:255.255.255.255")).toBe("255.255.255.255");
  });

  it("leaves what is no address as written: one bucket for that text and no other", () => {
    expect(bucketOf("not-an-ip")).toBe("not-an-ip");
    expect(bucketOf("2001:db8:::1")).toBe("2001:db8:::1");
  });
});

describe("the limiter, on the start route", () => {
  async function starts() {
    const app = await buildServer(loadConfig({ NODE_ENV: "test" }), {
      mailer: fakeMailer().mailer,
      repository: fakeRepository().repository,
    });
    return async (ip: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/access-request/start",
        headers: { "x-client-ip": ip },
        payload: { email: "marta@example.com" },
      });
      return response.statusCode;
    };
  }

  it("gives one /64 a single allowance, whichever of its addresses asks", async () => {
    const start = await starts();

    for (let i = 1; i <= 5; i += 1) expect(await start(`2001:db8:85a3:7::${i}`)).toBe(200);

    expect(await start("2001:db8:85a3:7:ffff::6")).toBe(429);
    expect(await start("2001:db8:85a3:8::1")).toBe(200);
  });

  it("still gives each IPv4 address its own", async () => {
    const start = await starts();

    for (let i = 0; i < 5; i += 1) expect(await start("203.0.113.7")).toBe(200);

    expect(await start("203.0.113.7")).toBe(429);
    expect(await start("203.0.113.8")).toBe(200);
  });

  it("gives an IPv4 address one allowance, however IPv6 writes it", async () => {
    const start = await starts();
    const forms = [
      "203.0.113.7",
      "::ffff:203.0.113.7",
      "::ffff:cb00:7107",
      "0:0:0:0:0:ffff:cb00:7107",
      "::203.0.113.7",
    ];

    for (const form of forms) expect(await start(form), form).toBe(200);

    expect(await start("::FFFF:203.0.113.7")).toBe(429);
    expect(await start("::ffff:203.0.113.8")).toBe(200);
  });

  it("counts a forwarded value that is no address with the connection's own", async () => {
    const start = await starts();

    for (let i = 0; i < 5; i += 1) expect(await start(`not-an-address-${i}`)).toBe(200);

    expect(await start("another-spelling")).toBe(429);
    expect(await start("2001:db8:::1")).toBe(429);
    expect(await start("203.0.113.7")).toBe(200);
  });
});
