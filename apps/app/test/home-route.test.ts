import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "@tunely/shared";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

describe("Expo Home route", () => {
  it("is wired to a screen that renders Tunely", async () => {
    const routeSource = await readFile(fileURLToPath(new URL("../app/index.tsx", import.meta.url)), "utf8");
    const homeScreenSource = await readFile(fileURLToPath(new URL("../src/screens/HomeScreen.tsx", import.meta.url)), "utf8");

    expect(routeSource).toContain("HomeScreen");
    expect(homeScreenSource).toContain("APP_NAME");
    expect(APP_NAME).toBe("Tunely");
    expect(appRoot).toContain("apps/app/");
  });
});
