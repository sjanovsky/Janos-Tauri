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

// The Planning page's sections (Taxes and Retirement to start; the user can add, rename and reorder
// them). Each section pulls from paycheck line items (older saves may hold whole buckets, which are
// expanded into their items on load), and is saved as one JSON setting. Until the user saves a layout, the defaults are used.
export const SECTIONS_KEY = "sections";
export const TAXES_SECTION_ID = "taxes";
export const RETIREMENT_SECTION_ID = "retirement";

export type PlanningSection = {
  id: string;
  name: string;
  color: string;
  // "item:<id>" (or a legacy "bucket:<id>"); each one is a row in the section.
  sources: string[];
  // Whether the section has a company match row (retirement-style).
  match: boolean;
};

// Paycheck line items the user took off the settings board (a JSON list of item ids).
export const HIDDEN_ITEMS_KEY = "hidden-items";

/** The saved hidden item ids; empty when nothing (usable) is saved. */
export function parseHiddenItems(text: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(text ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

// Payment lines the user took off the Forecast payments board (a JSON list of source keys).
export const HIDDEN_PAYMENTS_KEY = "hidden-payments";

// Accounts the user took off the Forecast payments board (a JSON list of account ids).
export const HIDDEN_ACCOUNTS_KEY = "hidden-accounts";

export const bucketSource = (bucketId: string) => `bucket:${bucketId}`;
export const itemSource = (itemId: string) => `item:${itemId}`;

/** The saved sections, or null when nothing (usable) is saved. */
export function parseSections(text: string | undefined): PlanningSection[] | null {
  if (text === undefined) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed.flatMap((entry): PlanningSection[] => {
      const section = entry as Partial<PlanningSection> | null;
      if (!section || typeof section.id !== "string" || typeof section.name !== "string") {
        return [];
      }
      return [
        {
          id: section.id,
          name: section.name,
          color: typeof section.color === "string" ? section.color : "#8b93a1",
          sources: Array.isArray(section.sources) ? section.sources.filter((source) => typeof source === "string") : [],
          match: section.match === true,
        },
      ];
    });
  } catch {
    return null;
  }
}

/** The paycheck items that are 401K contributions (a Roth 401K counts too). */
export function retirementItems(items: PaycheckItemRecord[]): PaycheckItemRecord[] {
  return items.filter((item) => /401\s*k/i.test(item.label));
}

/** Replaces any "bucket:<id>" source with "item:<id>" sources for the items now in that bucket. */
export function expandBucketSources(sections: PlanningSection[], items: PaycheckItemRecord[]): PlanningSection[] {
  return sections.map((section) => {
    if (!section.sources.some((source) => source.startsWith("bucket:"))) {
      return section;
    }
    const expanded = section.sources.flatMap((source) =>
      source.startsWith("bucket:")
        ? items.filter((item) => item.bucketId === source.slice("bucket:".length)).map((item) => itemSource(item.id))
        : [source],
    );
    return { ...section, sources: [...new Set(expanded)] };
  });
}

/**
 * Taxes and Retirement, built from the Cash Flow groups: the line items in the paycheck buckets in
 * its Taxes group, and those in its Savings group plus any ungrouped 401K item.
 */
export function defaultSections(
  items: PaycheckItemRecord[],
  taxBucketIds: string[],
  savingsBucketIds: string[],
  colors: { taxes: string; retirement: string },
): PlanningSection[] {
  const looseRetirement = retirementItems(items).filter((item) => !item.bucketId);
  const itemsIn = (bucketIds: string[]) =>
    items.filter((item) => item.bucketId && bucketIds.includes(item.bucketId)).map((item) => itemSource(item.id));
  return [
    {
      id: TAXES_SECTION_ID,
      name: "Taxes",
      color: colors.taxes,
      sources: itemsIn(taxBucketIds),
      match: false,
    },
    {
      id: RETIREMENT_SECTION_ID,
      name: "Retirement",
      color: colors.retirement,
      sources: [...itemsIn(savingsBucketIds), ...looseRetirement.map((item) => itemSource(item.id))],
      match: true,
    },
  ];
}

export const lineKey = (sectionId: string, source: string, paycheckId: string) =>
  `line:${sectionId}:${source}:${paycheckId}`;
export const SPENDING_KEY = "spending";
export const matchKey = (sectionId: string, paycheckId: string) => `match:${sectionId}:${paycheckId}`;

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

export type PlanLine = {
  // The section's source ("item:<id>") and the setting key its override is stored under.
  source: string;
  key: string;
  name: string;
  // The source's amounts on the current paycheck, annualized, and what's used (override or that).
  pulled: number;
  value: number;
  overridden: boolean;
};

export type SectionPlan = {
  sectionId: string;
  lines: PlanLine[];
  // The lines' sum, without the match.
  amount: number;
  match: MatchSetting | null;
  matchText: string;
  matchAmount: number;
};

export type PaycheckPlan = {
  paycheckId: string;
  name: string;
  color: string;
  baseSalary: number;
  extraIncome: number;
  annualIncome: number;
  sections: SectionPlan[];
};

/** One paycheck's yearly picture, using its current version going forward. */
export function planPaycheck(
  paycheck: PaycheckRecord,
  items: PaycheckItemRecord[],
  buckets: PaycheckBucketRecord[],
  settings: Map<string, string>,
  sections: PlanningSection[],
): PaycheckPlan {
  const version = currentVersion(paycheck);
  const gross = version?.gross ?? 0;
  const baseSalary = round2(gross * paycheck.paychecksPerYear);
  const annualIncome = round2(baseSalary + paycheck.extraIncome);

  const sourceInfo = (source: string): { name: string; itemIds: string[] } | null => {
    if (source.startsWith("bucket:")) {
      const bucket = buckets.find((candidate) => candidate.id === source.slice("bucket:".length));
      return bucket
        ? { name: bucket.name, itemIds: items.filter((item) => item.bucketId === bucket.id).map((item) => item.id) }
        : null;
    }
    const item = items.find((candidate) => candidate.id === source.slice("item:".length));
    return item ? { name: item.label, itemIds: [item.id] } : null;
  };

  const sectionPlans = sections.map((section): SectionPlan => {
    const lines = section.sources.flatMap((source): PlanLine[] => {
      const info = sourceInfo(source);
      if (!info) {
        return [];
      }
      const perCheck = version
        ? info.itemIds.reduce((sum, itemId) => sum + paycheckItemAmount(version, itemId), 0)
        : 0;
      const pulled = round2(perCheck * paycheck.paychecksPerYear);
      const key = lineKey(section.id, source, paycheck.id);
      const typed = parseAmount(settings.get(key) ?? "");
      return [{ source, key, name: info.name, pulled, value: typed ?? pulled, overridden: typed !== null }];
    });
    const amount = round2(lines.reduce((sum, line) => sum + line.value, 0));
    const matchText = section.match ? (settings.get(matchKey(section.id, paycheck.id)) ?? "") : "";
    const match = parseMatch(matchText);
    return {
      sectionId: section.id,
      lines,
      amount,
      match,
      matchText,
      matchAmount: matchAmount(match, annualIncome),
    };
  });

  return {
    paycheckId: paycheck.id,
    name: paycheck.name,
    color: paycheck.color,
    baseSalary,
    extraIncome: paycheck.extraIncome,
    annualIncome,
    sections: sectionPlans,
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

export type SectionTotal = { sectionId: string; amount: number; match: number };

export type PlanningTotals = {
  annualIncome: number;
  // Each section across every paycheck (the match isn't part of its amount).
  sections: SectionTotal[];
  spending: number;
  // Income left after every section and spending (the company match isn't paid out of income).
  remaining: number;
};

export function planningTotals(plans: PaycheckPlan[], sections: PlanningSection[], spending: number): PlanningTotals {
  const annualIncome = round2(plans.reduce((total, plan) => total + plan.annualIncome, 0));
  const sectionTotals = sections.map((section): SectionTotal => {
    const parts = plans.flatMap((plan) => plan.sections.filter((candidate) => candidate.sectionId === section.id));
    return {
      sectionId: section.id,
      amount: round2(parts.reduce((total, part) => total + part.amount, 0)),
      match: round2(parts.reduce((total, part) => total + part.matchAmount, 0)),
    };
  });
  const deducted = sectionTotals.reduce((total, section) => total + section.amount, 0);
  return {
    annualIncome,
    sections: sectionTotals,
    spending,
    remaining: round2(annualIncome - deducted - spending),
  };
}

// --- Forecast payments ---
//
// A planning line can be mapped to a Net Worth account; the Forecasting page then adds that line's
// yearly amount to the account as a payment each forecast year. A mapping is one planning setting:
// `pay:<source key>` → account id.

export const NET_INCOME_SOURCE = "net-income";
export const paymentKey = (sourceKey: string) => `pay:${sourceKey}`;

export type PaymentSource = { key: string; name: string; color: string; amount: number };

/** The planning lines that can be mapped: every section line and match per paycheck, and what's left over. */
export function paymentSources(
  plans: PaycheckPlan[],
  sections: PlanningSection[],
  totals: PlanningTotals,
): PaymentSource[] {
  return [
    ...plans.flatMap((plan) =>
      plan.sections.flatMap((sectionPlan) => {
        const section = sections.find((candidate) => candidate.id === sectionPlan.sectionId);
        return [
          ...sectionPlan.lines.map((line) => ({
            key: line.key,
            name: `${plan.name} ${line.name}`,
            color: plan.color,
            amount: line.value,
          })),
          ...(section && sectionPlan.matchAmount > 0
            ? [
                {
                  key: matchKey(section.id, plan.paycheckId),
                  name: `${plan.name} ${section.name} match`,
                  color: plan.color,
                  amount: sectionPlan.matchAmount,
                },
              ]
            : []),
        ];
      }),
    ),
    { key: NET_INCOME_SOURCE, name: "Net income", color: "#8b93a1", amount: Math.max(0, totals.remaining) },
  ];
}

/** Which account each source is mapped to, ignoring mappings to accounts that no longer exist. */
export function paymentMapping(
  sources: PaymentSource[],
  settings: Map<string, string>,
  accountIds: Set<string>,
): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const source of sources) {
    const accountId = settings.get(paymentKey(source.key));
    if (accountId && accountIds.has(accountId)) {
      mapping.set(source.key, accountId);
    }
  }
  return mapping;
}

/** The yearly payment into each account: the sum of the sources mapped to it. */
export function paymentsByAccount(sources: PaymentSource[], mapping: Map<string, string>): Record<string, number> {
  const payments: Record<string, number> = {};
  for (const source of sources) {
    const accountId = mapping.get(source.key);
    if (accountId) {
      payments[accountId] = round2((payments[accountId] ?? 0) + source.amount);
    }
  }
  return payments;
}
