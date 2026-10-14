import { describe, expect, it } from "vitest";
import { buildBankLogoMap, normalizeBankName } from "./banks";

describe("bank logo helpers", () => {
  it("normalizes bank names for matching", () => {
    expect(normalizeBankName(" Chase ")).toBe("chase");
    expect(normalizeBankName("Citi Bank")).toBe("citi bank");
  });

  it("builds a name-to-logo lookup that ignores case and spacing", () => {
    const logoMap = buildBankLogoMap([
      { id: "bank-1", name: "Chase", logoDataUrl: "data:image/png;base64,abc", spendingPositive: true },
      { id: "bank-2", name: "Citi Bank", logoDataUrl: "data:image/png;base64,def", spendingPositive: true },
    ]);

    expect(logoMap[normalizeBankName(" chase ")]).toBe("data:image/png;base64,abc");
    expect(logoMap[normalizeBankName("Citi   Bank")]).toBe("data:image/png;base64,def");
    expect(logoMap[normalizeBankName("Capital One")]).toBeUndefined();
  });
});
