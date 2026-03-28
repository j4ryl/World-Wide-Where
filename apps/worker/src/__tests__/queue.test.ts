import { describe, expect, it } from "vitest";

import { createDomainQueue } from "../queue";

describe("worker queue", () => {
  it("respects global and per-domain concurrency", async () => {
    const queue = createDomainQueue({
      maxConcurrent: 2,
      maxPerDomain: 1,
    });

    let activeTotal = 0;
    let maxActiveTotal = 0;
    const activeByDomain = new Map<string, number>();
    let maxSameDomain = 0;

    const runTask = (domain: string) =>
      queue.push({
        domain,
        run: async () => {
          activeTotal += 1;
          activeByDomain.set(domain, (activeByDomain.get(domain) ?? 0) + 1);
          maxActiveTotal = Math.max(maxActiveTotal, activeTotal);
          maxSameDomain = Math.max(maxSameDomain, activeByDomain.get(domain) ?? 0);
          await new Promise((resolve) => setTimeout(resolve, 40));
          activeTotal -= 1;
          activeByDomain.set(domain, (activeByDomain.get(domain) ?? 1) - 1);
          return domain;
        },
      });

    await Promise.all([
      runTask("reddit.com"),
      runTask("reddit.com"),
      runTask("sbb.ch"),
      runTask("jungfrau.ch"),
    ]);

    expect(maxActiveTotal).toBeLessThanOrEqual(2);
    expect(maxSameDomain).toBe(1);
  });
});
