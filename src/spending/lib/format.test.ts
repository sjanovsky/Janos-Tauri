import { describe, expect, it } from "vitest";
import { abbreviateCurrency } from "./format";

describe("abbreviateCurrency", () => {
  it("shows the full amount under $1,000", () => {
    expect(abbreviateCurrency(0)).toBe("$0");
    expect(abbreviateCurrency(750)).toBe("$750");
    expect(abbreviateCurrency(999)).toBe("$999");
  });

  it("rounds thousands to a whole K", () => {
    expect(abbreviateCurrency(1_000)).toBe("$1K");
    expect(abbreviateCurrency(1_329)).toBe("$1K");
    expect(abbreviateCurrency(26_700)).toBe("$27K");
    expect(abbreviateCurrency(154_084)).toBe("$154K");
  });

  it("keeps one decimal for millions and billions", () => {
    expect(abbreviateCurrency(1_010_679)).toBe("$1.0M");
    expect(abbreviateCurrency(10_909_122)).toBe("$10.9M");
    expect(abbreviateCurrency(2_500_000_000)).toBe("$2.5B");
  });

  it("doesn't spill a unit when thousands round up to a million", () => {
    expect(abbreviateCurrency(999_900)).toBe("$1.0M");
  });

  it("preserves the sign for a negative net worth", () => {
    expect(abbreviateCurrency(-1_329)).toBe("-$1K");
    expect(abbreviateCurrency(-10_909_122)).toBe("-$10.9M");
  });
});
