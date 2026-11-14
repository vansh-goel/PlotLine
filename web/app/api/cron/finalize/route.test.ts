import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const previousSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

describe("finalize keeper authorization", () => {
  it("fails closed when the keeper is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(new Request("http://localhost/api/cron/finalize"))).status).toBe(503);
  });

  it("rejects a request without the shared secret", async () => {
    process.env.CRON_SECRET = "test-secret";
    expect((await GET(new Request("http://localhost/api/cron/finalize"))).status).toBe(401);
  });
});
