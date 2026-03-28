import { describe, expect, it } from "vitest";

import { normalizeFlightObservationToSgd } from "../flight-currency";

describe("flight currency normalization", () => {
  it("converts common non-SGD fares into SGD strings and keeps original notes", () => {
    const normalized = normalizeFlightObservationToSgd({
      airline: "Test Air",
      seller: "Trip.com",
      route: "Singapore to Bangkok",
      baseFare: "THB 3200",
      totalFare: "USD 180",
      checkedBagPrice: "MYR 110",
      notes: [],
    });

    expect(normalized.baseFare).toBe("SGD 124.80");
    expect(normalized.totalFare).toBe("SGD 243");
    expect(normalized.checkedBagPrice).toBe("SGD 33");
    expect(normalized.notes).toEqual(
      expect.arrayContaining([
        "Original observed fare: THB 3200",
        "Original observed fare: USD 180",
        "Original observed fare: MYR 110",
      ]),
    );
  });

  it("keeps SGD values stable and normalized", () => {
    const normalized = normalizeFlightObservationToSgd({
      baseFare: "SGD 118",
      totalFare: "SGD 162.2",
      checkedBagPrice: "SGD 32",
      notes: [],
    });

    expect(normalized.baseFare).toBe("SGD 118");
    expect(normalized.totalFare).toBe("SGD 162.20");
    expect(normalized.checkedBagPrice).toBe("SGD 32");
    expect(normalized.notes).toEqual([]);
  });
});
