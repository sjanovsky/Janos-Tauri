// Pure federal-tax math for the Taxes page. No React, no Tauri — everything the page shows is
// derived here from the saved inputs, so it can be unit-tested against known numbers.

export interface HouseholdValueRecord {
  year: number;
  field: string;
  value: number;
}

export type TaxSection = "income" | "deduction" | "withholding";

/**
 * One user-defined line in a projected section. Year-end is `ytd + lastPaycheck × paychecksLeft`;
 * a one-off amount (interest, a gain) is just a `ytd` with nothing left to come.
 */
export interface TaxItemRecord {
  id: string;
  year: number;
  section: TaxSection;
  name: string;
  ytd: number;
  lastPaycheck: number;
  paychecksLeft: number;
  position: number;
  /** The overview category this line belongs to; lines are created and named there. */
  sankeyCategoryId?: string | null;
}

/** Year-end projection of a line: year to date + last paycheck × paychecks left. */
export function projectItem(item: Pick<TaxItemRecord, "ytd" | "lastPaycheck" | "paychecksLeft">): number {
  return item.ytd + item.lastPaycheck * Math.max(0, item.paychecksLeft);
}

export interface TaxesData {
  years: number[];
  items: TaxItemRecord[];
  householdValues: HouseholdValueRecord[];
}

// --- Inputs -------------------------------------------------------------------------------------

// Household-level federal tax lines the user types in (not derived), per the MVP.
export const TAX_LINE_FIELDS = [
  { key: "qualifiedTaxable", label: "Qualified dividends", sub: "amount" },
  { key: "qualifiedOwed", label: "Qualified dividends", sub: "tax owed" },
  { key: "capitalGainsTaxable", label: "Long-term capital gains", sub: "amount" },
  { key: "capitalGainsOwed", label: "Long-term capital gains", sub: "tax owed" },
  { key: "medicareOwed", label: "Additional Medicare", sub: "tax owed" },
  { key: "netInvestmentOwed", label: "Net investment income", sub: "tax owed" },
  { key: "underpaymentOwed", label: "Underpayment penalty", sub: "owed" },
] as const;

export type TaxLineField = (typeof TAX_LINE_FIELDS)[number]["key"];

// --- Tax tables (married filing jointly; fixed per the MVP) -------------------------------------

export interface Bracket {
  /** Lower bound of the bracket (taxable dollars above this are taxed at `rate`). */
  min: number;
  /** Upper bound; null for the top bracket. */
  max: number | null;
  rate: number;
}

export interface TaxTable {
  year: number;
  standardDeduction: number;
  brackets: Bracket[];
}

function bracketsFrom(limits: number[], rates: number[]): Bracket[] {
  return rates.map((rate, index) => ({
    min: index === 0 ? 0 : limits[index - 1],
    max: index < limits.length ? limits[index] : null,
    rate,
  }));
}

const RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];

export const TAX_TABLES: TaxTable[] = [
  {
    year: 2025,
    standardDeduction: 31_500,
    brackets: bracketsFrom([23_850, 96_950, 206_700, 394_600, 501_050, 751_600], RATES),
  },
  {
    year: 2026,
    standardDeduction: 32_200,
    brackets: bracketsFrom([24_800, 100_800, 211_400, 403_550, 512_450, 768_700], RATES),
  },
];

/** The table for `year`: an exact match, else the nearest earlier table, else the earliest. */
export function taxTableFor(year: number): { table: TaxTable; exact: boolean } {
  const exact = TAX_TABLES.find((table) => table.year === year);
  if (exact) {
    return { table: exact, exact: true };
  }
  const earlier = TAX_TABLES.filter((table) => table.year < year);
  const table = earlier.length > 0 ? earlier[earlier.length - 1] : TAX_TABLES[0];
  return { table, exact: false };
}

// --- Calculation --------------------------------------------------------------------------------

export interface BracketSlice {
  rate: number;
  min: number;
  max: number | null;
  /** Dollars of taxable income that fall inside this bracket. */
  amount: number;
  tax: number;
}

/** Apply the progressive brackets to `taxable`, returning one slice per bracket. */
export function applyBrackets(taxable: number, brackets: Bracket[]): BracketSlice[] {
  return brackets.map((bracket) => {
    const upper = bracket.max ?? Infinity;
    const amount = Math.max(0, Math.min(taxable, upper) - bracket.min);
    return { rate: bracket.rate, min: bracket.min, max: bracket.max, amount, tax: amount * bracket.rate };
  });
}

export interface ProjectedLine {
  id: string;
  name: string;
  /** Projected year-end amount. */
  amount: number;
}

export interface FederalResult {
  // Income side
  incomeLines: ProjectedLine[];
  /** Sum of all income lines (a negative line, e.g. a loss, reduces it). */
  grossIncome: number;
  deductions: ProjectedLine[];
  pretaxDeductions: number;
  income: number;
  standardDeduction: number;
  taxableIncome: number;
  // Tax side
  normalTaxable: number;
  slices: BracketSlice[];
  normalTax: number;
  qualifiedTaxable: number;
  qualifiedOwed: number;
  capitalGainsTaxable: number;
  capitalGainsOwed: number;
  medicareOwed: number;
  netInvestmentOwed: number;
  underpaymentOwed: number;
  totalOwed: number;
  effectiveRate: number;
  // Withholding side
  withholdings: ProjectedLine[];
  withheld: number;
  /** withheld − owed: positive is a refund, negative is a balance due. */
  balance: number;
}

export interface FederalInput {
  table: TaxTable;
  /** The year's lines from every section; they're split by `section` here. */
  items: TaxItemRecord[];
  taxLines: Partial<Record<TaxLineField, number>>;
}

export function computeFederal({ table, items, taxLines }: FederalInput): FederalResult {
  const linesFor = (section: TaxSection): ProjectedLine[] =>
    items
      .filter((item) => item.section === section)
      .map((item) => ({ id: item.id, name: item.name, amount: projectItem(item) }));
  const total = (lines: ProjectedLine[]) => lines.reduce((sum, line) => sum + line.amount, 0);

  const incomeLines = linesFor("income");
  const deductions = linesFor("deduction");
  const withholdings = linesFor("withholding");

  const grossIncome = total(incomeLines);
  const pretaxDeductions = total(deductions);
  // Roth contributions are after-tax, so they never come off income.
  const income = grossIncome - pretaxDeductions;
  const taxableIncome = Math.max(0, income - table.standardDeduction);

  const line = (key: TaxLineField) => taxLines[key] ?? 0;
  const qualifiedTaxable = line("qualifiedTaxable");
  // Qualified dividends are taxed at their own rate, so they come out of the regular brackets.
  const normalTaxable = Math.max(0, taxableIncome - qualifiedTaxable);
  const slices = applyBrackets(normalTaxable, table.brackets);
  const normalTax = slices.reduce((total, slice) => total + slice.tax, 0);

  const totalOwed =
    normalTax +
    line("qualifiedOwed") +
    line("capitalGainsOwed") +
    line("medicareOwed") +
    line("netInvestmentOwed") +
    line("underpaymentOwed");
  const withheld = total(withholdings);

  return {
    incomeLines,
    grossIncome,
    deductions,
    pretaxDeductions,
    income,
    standardDeduction: table.standardDeduction,
    taxableIncome,
    normalTaxable,
    slices,
    normalTax,
    qualifiedTaxable,
    qualifiedOwed: line("qualifiedOwed"),
    capitalGainsTaxable: line("capitalGainsTaxable"),
    capitalGainsOwed: line("capitalGainsOwed"),
    medicareOwed: line("medicareOwed"),
    netInvestmentOwed: line("netInvestmentOwed"),
    underpaymentOwed: line("underpaymentOwed"),
    totalOwed,
    effectiveRate: income > 0 ? totalOwed / income : 0,
    withholdings,
    withheld,
    balance: withheld - totalOwed,
  };
}

// --- Waterfall ----------------------------------------------------------------------------------

// Brackets climb in intensity so a higher rate reads as "hotter" without relying on hue alone.
// Shared by the bracket table and the taxable-income bar so the two always match.
export const BRACKET_SHADES = ["#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca", "#3730a3"];

const QUALIFIED_COLOR = "#64748b";
const TAX_SHADES = ["#e8590c", "#f08c00", "#ffa94d", "#c2410c", "#ffc078", "#9a3412"];

/** The accent color of each input section. Its header banner and its waterfall bar both use it. */
export type SectionTone = "green" | "blue" | "amber" | "violet";
export const SECTION_COLORS: Record<SectionTone, string> = {
  green: "#10b981",
  blue: "#3b82f6",
  amber: "#f59e0b",
  violet: "#8b5cf6",
};

/** `count` shades of `base`: the first is `base` exactly, each next one a step closer to white. */
function tintShades(base: string, count: number): string[] {
  const value = parseInt(base.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return Array.from({ length: count }, (_, index) => {
    const amount = count > 1 ? (index / (count - 1)) * 0.6 : 0;
    const hex = channels.map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0"));
    return `#${hex.join("")}`;
  });
}

/** Recolor segments bottom-to-top with the section's color, getting lighter as they stack up. */
function withSectionShades<T extends { color: string }>(segments: T[], tone: SectionTone): T[] {
  const shades = tintShades(SECTION_COLORS[tone], segments.length);
  return segments.map((segment, index) => ({ ...segment, color: shades[index] }));
}

/** One hoverable slice of a bar. `value` is a positive magnitude (what is drawn). */
export interface WaterfallSegment {
  key: string;
  label: string;
  /** Compact label that fits inside the bar. */
  shortLabel: string;
  value: number;
  color: string;
  /** Extra hover text, e.g. the bracket's rate and tax. */
  detail?: string;
}

export interface WaterfallBar {
  key: string;
  label: string;
  /** Where the bar starts and ends in value space. Bars float between these; totals start at 0. */
  start: number;
  end: number;
  /** Stacked from the lower edge upward. Their values sum to |end − start|. */
  segments: WaterfallSegment[];
  /** What the label above the bar shows: positive for a total, negative for a reduction. */
  shown: number;
}

/** Shrink `values` in order so they sum to no more than `limit` (later values give way first). */
function clipToLimit(values: number[], limit: number): number[] {
  let remaining = Math.max(0, limit);
  return values.map((value) => {
    const kept = Math.min(value, remaining);
    remaining -= kept;
    return kept;
  });
}

const dollars = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

/**
 * The whole story as one waterfall: earnings (each income line) → deductions → taxable income
 * (split by bracket) → taxes owed (split by kind) → taxes paid (split by line) → refund / owed.
 */
export function buildWaterfall(result: FederalResult): WaterfallBar[] {
  // Positive income lines build the earnings bar; negative ones (losses) come off in deductions.
  const gains = result.incomeLines.filter((line) => line.amount > 0);
  const losses = result.incomeLines.filter((line) => line.amount < 0);
  const gross = gains.reduce((total, line) => total + line.amount, 0);

  // Deductions drawn in this order: the user's lines, income losses, then the standard deduction.
  // If they exceed earnings the later ones give way, so the bar always lands exactly on taxable
  // income.
  const deductionDefs = [
    ...result.deductions.map((line) => ({
      key: `deduction-${line.id}`,
      label: line.name || "Unnamed deduction",
      shortLabel: line.name || "Deduction",
      value: line.amount,
      color: "",
    })),
    ...losses.map((line) => ({
      key: `loss-${line.id}`,
      label: `${line.name || "Income"} (loss)`,
      shortLabel: "Loss",
      value: -line.amount,
      color: "",
    })),
    { key: "std", label: "Standard deduction", shortLabel: "Std. deduction", value: result.standardDeduction, color: "" },
  ].filter((def) => def.value > 0);
  const clipped = clipToLimit(
    deductionDefs.map((def) => def.value),
    gross,
  );
  const deductionSegments: WaterfallSegment[] = withSectionShades(
    deductionDefs
      .map((def, index) => ({
        ...def,
        value: clipped[index],
        detail: clipped[index] < def.value ? `Only ${dollars(clipped[index])} of ${dollars(def.value)} was needed` : undefined,
      }))
      .filter((segment) => segment.value > 0),
    "blue",
  );
  const deducted = deductionSegments.reduce((total, segment) => total + segment.value, 0);
  const taxable = Math.max(0, gross - deducted);

  const bracketSegments: WaterfallSegment[] = result.slices
    .map((slice, index) => ({ slice, index }))
    .filter(({ slice }) => slice.amount > 0)
    .map(({ slice, index }) => ({
      key: `bracket-${slice.rate}`,
      label: `${Math.round(slice.rate * 100)}% bracket`,
      shortLabel: `${Math.round(slice.rate * 100)}%`,
      value: slice.amount,
      color: BRACKET_SHADES[index],
      detail: `${dollars(slice.min)} – ${slice.max === null ? "and up" : dollars(slice.max)} · ${dollars(slice.tax)} tax`,
    }));
  const qualifiedShare = Math.max(0, taxable - result.normalTaxable);
  const taxableSegments = [...bracketSegments];
  if (qualifiedShare > 0) {
    taxableSegments.push({
      key: "qualified",
      label: "Qualified dividends",
      shortLabel: "Qualified",
      value: qualifiedShare,
      color: QUALIFIED_COLOR,
      detail: `Taxed separately: ${dollars(result.qualifiedOwed)}`,
    });
  }

  const taxDefs = [
    { key: "normal", label: "Income tax", shortLabel: "Income tax", value: result.normalTax },
    { key: "qualified", label: "Qualified dividends", shortLabel: "Qualified", value: result.qualifiedOwed },
    { key: "gains", label: "Capital gains", shortLabel: "Cap. gains", value: result.capitalGainsOwed },
    { key: "medicare", label: "Additional Medicare", shortLabel: "Medicare", value: result.medicareOwed },
    { key: "nii", label: "Net investment income", shortLabel: "NII", value: result.netInvestmentOwed },
    { key: "penalty", label: "Underpayment penalty", shortLabel: "Penalty", value: result.underpaymentOwed },
  ];
  const taxSegments: WaterfallSegment[] = taxDefs
    .map((def, index) => ({ ...def, color: TAX_SHADES[index] }))
    .filter((segment) => segment.value > 0);

  const withheldSegments: WaterfallSegment[] = withSectionShades(
    result.withholdings
      .map((line) => ({
        key: `withheld-${line.id}`,
        label: line.name || "Withheld",
        shortLabel: line.name || "Withheld",
        value: Math.max(0, line.amount),
        color: "",
      }))
      .filter((segment) => segment.value > 0),
    "amber",
  );
  const withheld = withheldSegments.reduce((total, segment) => total + segment.value, 0);

  const owed = result.totalOwed;
  // Positive: still owed. Negative: overpaid, so the bar hangs below the baseline as a refund.
  const remaining = owed - withheld;
  const resultColor = remaining > 0 ? "#dc2626" : "#16a34a";
  const resultLabel = remaining > 0 ? "You owe" : "Refund";

  const earningsSegments: WaterfallSegment[] = withSectionShades(
    gains.map((line) => ({
      key: `income-${line.id}`,
      label: line.name || "Unnamed income",
      shortLabel: line.name || "Income",
      value: line.amount,
      color: "",
    })),
    "green",
  );

  return [
    { key: "earnings", label: "Earnings", start: 0, end: gross, segments: earningsSegments, shown: gross },
    { key: "deductions", label: "Deductions", start: gross, end: taxable, segments: deductionSegments, shown: -deducted },
    { key: "taxable", label: "Taxable income", start: 0, end: taxable, segments: taxableSegments, shown: taxable },
    { key: "owed", label: "Taxes owed", start: 0, end: owed, segments: taxSegments, shown: owed },
    { key: "paid", label: "Taxes paid", start: owed, end: remaining, segments: withheldSegments, shown: -withheld },
    {
      key: "result",
      label: resultLabel,
      start: 0,
      end: remaining,
      segments: [{ key: "result", label: resultLabel, shortLabel: resultLabel, value: Math.abs(remaining), color: resultColor }],
      shown: Math.abs(remaining),
    },
  ];
}
