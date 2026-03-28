import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)));

describe("frontend copy", () => {
  it("uses plain, understandable wording in key UI components", () => {
    const tripForm = fs.readFileSync(path.join(webRoot, "components", "TripForm.tsx"), "utf8");
    const progressPanel = fs.readFileSync(path.join(webRoot, "components", "ProgressPanel.tsx"), "utf8");
    const planningFlow = fs.readFileSync(path.join(webRoot, "components", "PlanningFlowPanel.tsx"), "utf8");

    expect(tripForm).toContain("Trip copilot");
    expect(tripForm).toContain("Send to copilot");
    expect(progressPanel).toContain("What the app is checking");
    expect(planningFlow).toContain("Pick the places first");
    expect(tripForm).not.toContain("God-mode");
    expect(progressPanel).not.toContain("Terminal of Truth");
  });
});
