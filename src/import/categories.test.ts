import { describe, expect, it } from "vitest";
import {
  deriveCategoryList,
  generateCategoryId,
  getCategoryColor,
  resolveCategoryInput,
  slugifyCategoryLabel,
} from "./categories";

describe("resolveCategoryInput", () => {
  it("matches a default or reserved category case-insensitively", () => {
    expect(resolveCategoryInput("Groceries")).toBe("groceries");
    expect(resolveCategoryInput("TRANSFERS")).toBe("transfers");
  });

  it("falls back to unclassified for blank or undefined input", () => {
    expect(resolveCategoryInput(undefined)).toBe("unclassified");
    expect(resolveCategoryInput("")).toBe("unclassified");
    expect(resolveCategoryInput("   ")).toBe("unclassified");
  });

  it("preserves an unrecognized value instead of discarding it", () => {
    expect(resolveCategoryInput("Dining Out")).toBe("Dining Out");
    expect(resolveCategoryInput("  Bills  ")).toBe("Bills");
  });

  it("reuses an existing category id when the label matches a known category", () => {
    const known = [
      { id: "restaurants", label: "Restaraunt" },
      { id: "card-payment", label: "Card Payment" },
    ];
    // Label match → existing id, even though its id differs from the label slug.
    expect(resolveCategoryInput("Restaraunt", known)).toBe("restaurants");
    expect(resolveCategoryInput("card payment", known)).toBe("card-payment");
    // Id match also resolves to the same id.
    expect(resolveCategoryInput("restaurants", known)).toBe("restaurants");
  });

  it("only creates a new category id when nothing matches", () => {
    const known = [{ id: "restaurants", label: "Restaraunt" }];
    expect(resolveCategoryInput("Weed", known)).toBe("Weed");
  });
});

describe("deriveCategoryList", () => {
  it("always includes the default categories", () => {
    const list = deriveCategoryList([]);
    expect(list).toEqual(["fixed", "groceries", "partying", "restaurants", "stuff"]);
  });

  it("adds distinct non-reserved categories found in the data, deduped case-insensitively", () => {
    const list = deriveCategoryList([
      { category: "Dining" },
      { category: "dining" },
      { category: "unclassified" },
      { category: "transfers" },
    ]);

    expect(list).toContain("Dining");
    expect(list.filter((category) => category.toLowerCase() === "dining")).toHaveLength(1);
    expect(list).not.toContain("unclassified");
    expect(list).not.toContain("transfers");
  });

  it("includes extra category ids even with no matching transactions", () => {
    const list = deriveCategoryList([], ["travel"]);
    expect(list).toContain("travel");
  });

  it("excludes reserved categories passed as extra ids", () => {
    const list = deriveCategoryList([], ["unclassified", "transfers"]);
    expect(list).not.toContain("unclassified");
    expect(list).not.toContain("transfers");
  });
});

describe("slugifyCategoryLabel", () => {
  it("lowercases and hyphenates whitespace", () => {
    expect(slugifyCategoryLabel("Dining Out")).toBe("dining-out");
  });

  it("strips punctuation and collapses repeated separators", () => {
    expect(slugifyCategoryLabel("  Kids' Stuff!! ")).toBe("kids-stuff");
  });

  it("falls back to a default slug for empty input", () => {
    expect(slugifyCategoryLabel("   ")).toBe("category");
  });
});

describe("generateCategoryId", () => {
  it("returns the plain slug when it isn't taken", () => {
    expect(generateCategoryId("Travel", ["restaurants"])).toBe("travel");
  });

  it("suffixes the slug to avoid colliding with an existing id", () => {
    expect(generateCategoryId("Restaurants", ["restaurants"])).toBe("restaurants-2");
  });

  it("keeps incrementing the suffix past multiple collisions", () => {
    expect(generateCategoryId("Restaurants", ["restaurants", "restaurants-2"])).toBe("restaurants-3");
  });

  it("avoids colliding with reserved categories", () => {
    expect(generateCategoryId("Unclassified", [])).toBe("unclassified-2");
  });
});

describe("getCategoryColor", () => {
  it("returns a fixed color for the default categories", () => {
    expect(getCategoryColor("restaurants")).toBe("#2a78d6");
  });

  it("is deterministic for custom categories", () => {
    expect(getCategoryColor("Dining")).toBe(getCategoryColor("Dining"));
  });
});
