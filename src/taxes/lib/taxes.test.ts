import { describe, expect, it } from "vitest";
import {
  applyBrackets,
  buildWaterfall,
  computeFederal,
  projectItem,
  taxTableFor,
  type TaxItemRecord,
  type TaxSection,
} from "./taxes";

const table2026 = taxTableFor(2026).table;

let nextId = 0;
function item(
  section: TaxSection,
  name: string,
  ytd: number,
  lastPaycheck = 0,
  paychecksLeft = 0,
): TaxItemRecord {
  nextId += 1;
  return { id: `i${nextId}`, year: 2026, section, name, ytd, lastPaycheck, paychecksLeft, position: nextId };
}

describe("taxTableFor", () => {
  it("returns exact tables and falls back to the nearest earlier one", () => {
    expect(taxTableFor(2026).exact).toBe(true);
    const future = taxTableFor(2030);
    expect(future.exact).toBe(false);
    expect(future.table.year).toBe(2026);
    expect(taxTableFor(2020).table.year).toBe(2025);
  });
});

describe("applyBrackets", () => {
  it("taxes each slice at its own rate", () => {
    const slices = applyBrackets(50_000, table2026.brackets);
    expect(slices[0].amount).toBe(24_800);
    expect(slices[0].tax).toBeCloseTo(2_480);
    expect(slices[1].amount).toBe(25_200);
    expect(slices[1].tax).toBeCloseTo(3_024);
    expect(slices[2].amount).toBe(0);
  });

  it("handles income past the top bracket", () => {
    const slices = applyBrackets(1_000_000, table2026.brackets);
    expect(slices[6].amount).toBe(1_000_000 - 768_700);
  });
});

describe("projectItem", () => {
  it("projects year to date plus last paycheck for each paycheck left", () => {
    expect(projectItem({ ytd: 2_661, lastPaycheck: 163, paychecksLeft: 8 })).toBe(3_965);
  });

  it("treats a one-off amount as just its year-to-date value", () => {
    expect(projectItem({ ytd: 2_000, lastPaycheck: 0, paychecksLeft: 0 })).toBe(2_000);
  });

  it("ignores a negative paychecks-left count", () => {
    expect(projectItem({ ytd: 100, lastPaycheck: 50, paychecksLeft: -2 })).toBe(100);
  });
});

// Mirrors the household spreadsheet this page was built from (2026, married filing jointly).
describe("computeFederal — spreadsheet household", () => {
  const items = [
    item("income", "Stephen paycheck", 111_130, 7_038.5, 10),
    item("income", "Rachel paycheck", 89_996, 6_250, 8),
    item("income", "Interest", 2_000),
    item("income", "Dividends", 3_300),
    item("income", "Crypto", 10),
    item("deduction", "401(k)", 2_661, 162.625, 8),
    item("deduction", "HSA", 4_471, 298.125, 8),
    item("withholding", "Stephen federal", 20_318, 1_255.9, 10),
    item("withholding", "Rachel federal", 11_689, 740.125, 8),
  ];

  const result = computeFederal({
    table: table2026,
    items,
    taxLines: {
      qualifiedTaxable: 3_000,
      qualifiedOwed: 450,
      capitalGainsTaxable: 27_369,
      capitalGainsOwed: 4_105,
      medicareOwed: 600,
      netInvestmentOwed: 233,
    },
  });

  it("matches the sheet's income and taxable income", () => {
    expect(result.income).toBeCloseTo(316_003, 0);
    expect(result.pretaxDeductions).toBeCloseTo(3_962 + 6_856, 0);
    expect(result.taxableIncome).toBeCloseTo(283_803, 0);
    expect(result.normalTaxable).toBeCloseTo(280_803, 0);
  });

  it("matches the sheet's tax, withholding and balance", () => {
    expect(result.normalTax).toBeCloseTo(52_589, 0);
    expect(result.totalOwed).toBeCloseTo(57_977, 0);
    expect(result.withheld).toBeCloseTo(50_487, 0);
    expect(result.balance).toBeCloseTo(-7_490, 0);
    expect(result.effectiveRate).toBeCloseTo(0.18, 2);
  });

  it("builds one waterfall whose bars connect end to end", () => {
    const [earnings, deductions, taxable, owed, paid, balance] = buildWaterfall(result);
    expect(deductions.start).toBeCloseTo(earnings.end);
    expect(deductions.end).toBeCloseTo(taxable.end);
    expect(taxable.end).toBeCloseTo(result.taxableIncome, 0);
    expect(owed.end).toBeCloseTo(result.totalOwed, 0);
    expect(paid.start).toBeCloseTo(owed.end);
    expect(paid.end).toBeCloseTo(balance.end);
    expect(balance.label).toBe("You owe");
    expect(balance.shown).toBeCloseTo(7_490, 0);
  });

  it("splits every section into one hoverable segment per line", () => {
    const [earnings, deductions, taxable, , paid] = buildWaterfall(result);
    expect(earnings.segments.map((segment) => segment.label)).toEqual([
      "Stephen paycheck",
      "Rachel paycheck",
      "Interest",
      "Dividends",
      "Crypto",
    ]);
    expect(deductions.segments.map((segment) => segment.label)).toEqual([
      "401(k)",
      "HSA",
      "Standard deduction",
    ]);
    expect(paid.segments.map((segment) => segment.label)).toEqual(["Stephen federal", "Rachel federal"]);
    // Every bar's segments add up to the span it covers.
    buildWaterfall(result).forEach((bar) => {
      const total = bar.segments.reduce((sum, segment) => sum + segment.value, 0);
      expect(total).toBeCloseTo(Math.abs(bar.end - bar.start), 4);
    });
    // Taxable income is colored by bracket, with qualified dividends on top.
    expect(taxable.segments[taxable.segments.length - 1].label).toBe("Qualified dividends");
  });
});

describe("computeFederal — edge cases", () => {
  it("never produces negative taxable income and reports a refund", () => {
    const result = computeFederal({
      table: table2026,
      items: [item("income", "Paycheck", 10_000), item("withholding", "Federal", 1_000)],
      taxLines: {},
    });
    expect(result.taxableIncome).toBe(0);
    expect(result.totalOwed).toBe(0);
    expect(result.balance).toBe(1_000);
    const bars = buildWaterfall(result);
    const last = bars[bars.length - 1];
    expect(last.label).toBe("Refund");
    expect(last.end).toBe(-1_000);
    expect(last.shown).toBe(1_000);
    // Deductions can't push the bar past zero when income is below the standard deduction.
    expect(bars[1].end).toBe(0);
    expect(bars[1].segments.reduce((sum, segment) => sum + segment.value, 0)).toBe(10_000);
  });

  it("moves a negative income line (a loss) into the deductions bar", () => {
    const result = computeFederal({
      table: table2026,
      items: [item("income", "Paycheck", 100_000), item("income", "Gambling", -5_000)],
      taxLines: {},
    });
    expect(result.income).toBe(95_000);
    const [earnings, deductions, taxable] = buildWaterfall(result);
    expect(earnings.end).toBe(100_000);
    expect(deductions.segments.map((segment) => segment.label)).toContain("Gambling (loss)");
    expect(taxable.end).toBe(95_000 - 32_200);
  });

  it("handles a year with no lines at all", () => {
    const result = computeFederal({ table: table2026, items: [], taxLines: {} });
    expect(result.totalOwed).toBe(0);
    expect(result.balance).toBe(0);
    expect(buildWaterfall(result)).toHaveLength(6);
  });
});
