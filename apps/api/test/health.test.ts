import { afterEach, describe, expect, it } from "vitest";
import { createApiApp } from "../src/app";

const apps = new Set<ReturnType<typeof createApiApp>>();

describe("GET /api/health", () => {
  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  it("returns an ok response without binding a port", async () => {
    const app = createApiApp();
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
