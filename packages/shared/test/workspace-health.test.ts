import { describe, expect, it } from "vitest";
import { APP_NAME } from "@tunely/shared";

describe("workspace health", () => {
  it("exports the Tunely app name from the shared package", () => {
    expect(APP_NAME).toBe("Tunely");
  });
});
