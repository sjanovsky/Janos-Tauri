// The Planning page's numbers: the next 12 months, built from what the other pages already hold
// (paychecks, the Taxes estimate, spending history). Every pulled-in figure can be overridden; an
// override is stored under a key and removing it brings the pulled value back. Pure functions, no
// React, no Tauri.

import {
  INCOME_BUCKET_ID,
  isTransferCategory,
  type CategoryRecord,
} from "../../spending/lib/categories";
import { parseDate } from "../../spending/lib/transactionSummary";
import {
  currentVersion,
  paycheckItemAmount,
  type PaycheckBucketRecord,
  type PaycheckItemRecord,
  type PaycheckRecord,
} from "../../income/lib/income";
import { computeFederal, taxTableFor, type TaxesData } from "../../taxes/lib/taxes";
import type { ImportedTransaction } from "../../upload/lib/csvParser";

export type PlanningSettingRecord = { key: string; value: string };

// Which paycheck buckets count as taxes: stored as a comma-separated list of bucket ids. Until the
// user chooses, the buckets whose names look like withholding or taxes are used.
export const TAX_BUCKETS_KEY = "tax-buckets";

export function taxBucketIds(buckets: PaycheckBucketRecord[], settings: Map<string, string>): string[] {
  const saved = settings.get(TAX_BUCKETS_KEY);
  if (saved !== undefined) {
    const chosen = new Set(saved.split(",").filter(Boolean));
    return buckets.filter((bucket) => chosen.has(bucket.id)).map((bucket) => bucket.id);
  }
  return buckets.filter((bucket) => /withhold|tax/i.test(bucket.name)).map((bucket) => bucket.id);
}
export const taxKey = (bucketId: string, paycheckId: string) => `tax:${bucketId}:${paycheckId}`;
export const SPENDING_KEY = "spending";
export const retirementKey = (paycheckId: string) => `401k:${paycheckId}`;
export const matchKey = (paycheckId: string) => `match:${paycheckId}`;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A typed amount ("1,200", "$1200"); null when it isn't a number. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export type MatchSetting = { kind: "percent" | "amount"; value: number };

/** A company match as typed: "5%" is a share of annual income, "1200" a yearly dollar amount. */
export function parseMatch(text: string): MatchSetting | null {
  const trimmed = text.trim();
  if (trimmed.endsWith("%")) {
    const value = parseAmount(trimmed.slice(0, -1));
    return value === null ? null : { kind: "percent", value };
  }
  const value = parseAmount(trimmed);
  return value === null ? null : { kind: "amount", value };
}

export function matchAmount(match: MatchSetting | null, annualIncome: number): number {
  if (!match) {
    return 0;
  }
  return round2(match.kind === "percent" ? (annualIncome * match.value) / 100 : match.value);
}

/** The paycheck items that are 401K contributions (a Roth 401K counts too). */
export function retirementItems(items: PaycheckItemRecord[]): PaycheckItemRecord[] {
  return items.filter((item) => /401\s*k/i.test(item.label));
}

export type TaxLine = {
  bucketId: string;
  name: string;
  // The bucket's items on the current paycheck, annualized, and what's used (override or that).
  pulled: number;
  value: number;
  overridden: boolean;
};

export type PaycheckPlan = {
  paycheckId: string;
  name: string;
  color: string;
  gross: number;
  paychecksPerYear: number;
  baseSalary: number;
  extraIncome: number;
  annualIncome: number;
  // 401K per paycheck on the current paycheck, annualized, and what's used (override or that).
  taxLines: TaxLine[];
  taxes: number;
  retirementDefault: number;
  retirement: number;
  retirementOverridden: boolean;
  match: MatchSetting | null;
  matchText: string;
  matchAmount: number;
};

/** One paycheck's yearly picture, using its current version going forward. */
export function planPaycheck(
  paycheck: PaycheckRecord,
  items: PaycheckItemRecord[],
  buckets: PaycheckBucketRecord[],
  settings: Map<string, string>,
): PaycheckPlan {
  const version = currentVersion(paycheck);
  const gross = version?.gross ?? 0;
  const baseSalary = round2(gross * paycheck.paychecksPerYear);
  const annualIncome = round2(baseSalary + paycheck.extraIncome);

  const perPaycheck = version
    ? retirementItems(items).reduce((sum, item) => sum + paycheckItemAmount(version, item.id), 0)
    : 0;
  const retirementDefault = round2(perPaycheck * paycheck.paychecksPerYear);
  const typedRetirement = parseAmount(settings.get(retirementKey(paycheck.id)) ?? "");

  const taxLines = taxBucketIds(buckets, settings).flatMap((bucketId): TaxLine[] => {
    const bucket = buckets.find((candidate) => candidate.id === bucketId);
    if (!bucket) {
      return [];
    }
    const perCheck = version
      ? items
          .filter((item) => item.bucketId === bucketId)
          .reduce((sum, item) => sum + paycheckItemAmount(version, item.id), 0)
      : 0;
    const pulled = round2(perCheck * paycheck.paychecksPerYear);
    const typed = parseAmount(settings.get(taxKey(bucketId, paycheck.id)) ?? "");
    return [{ bucketId, name: bucket.name, pulled, value: typed ?? pulled, overridden: typed !== null }];
  });

  const matchText = settings.get(matchKey(paycheck.id)) ?? "";
  const match = parseMatch(matchText);
  return {
    paycheckId: paycheck.id,
    name: paycheck.name,
    color: paycheck.color,
    gross,
    paychecksPerYear: paycheck.paychecksPerYear,
    baseSalary,
    extraIncome: paycheck.extraIncome,
    annualIncome,
    taxLines,
    taxes: round2(taxLines.reduce((sum, line) => sum + line.value, 0)),
    retirementDefault,
    retirement: typedRetirement ?? retirementDefault,
    retirementOverridden: typedRetirement !== null,
    match,
    matchText,
    matchAmount: matchAmount(match, annualIncome),
  };
}

/**
 * The Taxes page's full-year estimate: total federal tax owed for the current year, or the latest
 * year entered when the current one isn't there. Null when the Taxes page has no years yet.
 */
export function estimatedTaxes(data: TaxesData, currentYear: number): number | null {
  if (data.years.length === 0) {
    return null;
  }
  const year = data.years.includes(currentYear) ? currentYear : Math.max(...data.years);
  const { table } = taxTableFor(year);
  const householdValues: Record<string, number> = {};
  data.householdValues.filter((record) => record.year === year).forEach((record) => {
    householdValues[record.field] = record.value;
  });
  return round2(
    computeFederal({
      table,
      items: data.items.filter((item) => item.year === year),
      taxLines: householdValues,
    }).totalOwed,
  );
}

export type SpendingHistory = {
  // Last full month's spending, and the average full month over the trailing 12, both ×12.
  lastMonthAnnualized: number;
  trailingAnnualized: number;
  // How many months the trailing average covers (fewer than 12 when history is short).
  trailingMonths: number;
};

const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();

/**
 * Spending by full calendar month, same rules as Cash Flow: paycheck deposits, transfers, excluded
 * categories and other income aren't spending. "Last month" is the month before `today`'s; the
 * trailing average is over the 12 full months ending there (or since the first transaction, when
 * history is shorter). Months with no transactions inside that span count as zero spending.
 */
export function spendingHistory(
  transactions: ImportedTransaction[],
  categories: CategoryRecord[],
  paychecks: PaycheckRecord[],
  today: Date,
): SpendingHistory {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const paycheckIds = new Set(paychecks.map((paycheck) => paycheck.id));
  const lastIndex = monthIndex(today) - 1;
  const byMonth = new Map<number, number>();
  let first = Infinity;

  for (const transaction of transactions) {
    const date = parseDate(transaction.date);
    if (!date || paycheckIds.has(transaction.category) || isTransferCategory(transaction.category)) {
      continue;
    }
    const record = categoryById.get(transaction.category);
    if (record?.excluded || record?.bucketId === INCOME_BUCKET_ID) {
      continue;
    }
    const index = monthIndex(date);
    first = Math.min(first, index);
    // Stored spending is negative.
    byMonth.set(index, (byMonth.get(index) ?? 0) - transaction.amount);
  }

  const months = first === Infinity ? 0 : Math.min(12, Math.max(0, lastIndex - first + 1));
  let total = 0;
  for (let index = lastIndex - months + 1; index <= lastIndex; index += 1) {
    total += byMonth.get(index) ?? 0;
  }
  return {
    lastMonthAnnualized: round2((byMonth.get(lastIndex) ?? 0) * 12),
    trailingAnnualized: months === 0 ? 0 : round2((total / months) * 12),
    trailingMonths: months,
  };
}

export type PlanningTotals = {
  annualIncome: number;
  taxes: number;
  retirement: number;
  match: number;
  spending: number;
  // Income left after taxes (withholding and payroll taxes), 401K and spending (the company match isn't paid out of income).
  remaining: number;
  // 401K plus the company match.
  retirementSaved: number;
};

export function planningTotals(plans: PaycheckPlan[], spending: number): PlanningTotals {
  const sum = (pick: (plan: PaycheckPlan) => number) => round2(plans.reduce((total, plan) => total + pick(plan), 0));
  const annualIncome = sum((plan) => plan.annualIncome);
  const taxes = sum((plan) => plan.taxes);
  const retirement = sum((plan) => plan.retirement);
  const match = sum((plan) => plan.matchAmount);
  return {
    annualIncome,
    taxes,
    retirement,
    match,
    spending,
    remaining: round2(annualIncome - taxes - retirement - spending),
    retirementSaved: round2(retirement + match),
  };
}

