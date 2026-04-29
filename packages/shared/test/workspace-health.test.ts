import { describe, expect, it } from "vitest";
import {
  APP_NAME,
  getImportPolicyModeCopy,
  isImportPolicyMode,
  parseImportPolicyMode
} from "@broadside/shared";

describe("workspace health", () => {
  it("exports the Broadside app name from the shared package", () => {
    expect(APP_NAME).toBe("Broadside");
  });

  it("defines the YouTube import policy modes and shared copy", () => {
    expect(isImportPolicyMode("open_test")).toBe(true);
    expect(isImportPolicyMode("review_required")).toBe(true);
    expect(isImportPolicyMode("licensed_only")).toBe(true);
    expect(isImportPolicyMode("anything_goes")).toBe(false);
    expect(parseImportPolicyMode("open_test")).toBe("open_test");
    expect(parseImportPolicyMode("unknown")).toBe("licensed_only");
    expect(getImportPolicyModeCopy("open_test")).toMatchObject({
      badge: "Open test mode"
    });
  });
});
