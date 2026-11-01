import { describe, expect, it } from "vitest";
import { findDuplicateIndexes } from "./duplicates";
import type { ImportedTransaction } from "./csvParser";

function tx(date: string, amount: number, description: string, bank = "Chase"): ImportedTransaction {
  return {
    id: crypto.randomUUID(),
    date,
    description,
    cardMember: "",
    accountNumber: "",
    amount,
    sourceBank: bank,
    sourceFileName: "f.csv",
    category: "unclassified",
  };
}

describe("findDuplicateIndexes", () => {
  it("flags incoming rows matching an existing row", () => {
    const existing = [tx("1/5/2026", -5, "Coffee")];
    const incoming = [tx("1/5/2026", -5, "Coffee"), tx("1/6/2026", -5, "Coffee")];
    expect([...findDuplicateIndexes(incoming, existing)]).toEqual([0]);
  });

  it("ignores case, whitespace and date padding", () => {
    const existing = [tx("01/05/2026", -5, "Corner  Coffee")];
    const incoming = [tx("1/5/26", -5, " corner coffee ")];
    expect(findDuplicateIndexes(incoming, existing).size).toBe(1);
  });

  it("only matches within the same bank", () => {
    const existing = [tx("1/5/2026", -5, "Coffee", "Amex")];
    expect(findDuplicateIndexes([tx("1/5/2026", -5, "Coffee", "Chase")], existing).size).toBe(0);
  });

  it("does not compare incoming rows against each other", () => {
    const incoming = [tx("1/5/2026", -5, "Coffee"), tx("1/5/2026", -5, "Coffee")];
    expect(findDuplicateIndexes(incoming, []).size).toBe(0);
  });

  it("flags every identical incoming row when one exists already", () => {
    const existing = [tx("1/5/2026", -5, "Coffee")];
    const incoming = [tx("1/5/2026", -5, "Coffee"), tx("1/5/2026", -5, "Coffee")];
    expect(findDuplicateIndexes(incoming, existing).size).toBe(2);
  });
});
