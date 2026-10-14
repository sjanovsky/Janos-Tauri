// Where the Sankey's numbers come from. One year, year to date:
//   - paycheck categories (income, taxes withheld, 401(k)...) take the year's paycheck lines, the
//     same rows the Taxes page reads;
//   - spending takes the bank transactions, grouped by their spending bucket;
//   - description rules route transactions elsewhere: a paycheck deposit (used only to check the
//     paycheck numbers against the bank) or into a Sankey bucket (e.g. brokerage transfers).
// Pure functions, no React: everything the page shows is derived here so it can be unit-tested.

import { normalizeBankName } from "../../spending/lib/banks";
import {
  UNCLASSIFIED_BUCKET_COLOR,
  UNCLASSIFIED_CATEGORY,
  UNGROUPED_BUCKET_COLOR,
  isTransferCategory,
} from "../../spending/lib/categories";
import { parseDate } from "../../spending/lib/transactionSummary";
import type { SankeyBucketRecord, SankeyCategoryRecord, SpendingBucketRef } from "./sankey";

export type SankeyLineRecord = {
  categoryId: string;
  year: number;
  ytd: number;
  lastPaycheck: number;
  paychecksLeft: number;
};

export type SankeyRuleKind = "paycheck" | "bucket";

export type SankeyRuleRecord = {
  id: string;
  name: string;
  // Matches when the transaction's description contains this text, ignoring case.
  pattern: string;
  kind: SankeyRuleKind;
  // The Sankey bucket a "bucket" rule counts toward.
  bucketId: string | null;
  position: number;
};

// The slice of a stored transaction the flow needs (structurally an ImportedTransaction).
export type FlowSourceTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  sourceBank: string;
  category: string;
};

export type FlowBank = { name: string; spendingPositive: boolean };

export type FlowSpendingBucket = SpendingBucketRef & { position: number };

export type FlowSpendingCategory = { id: string; bucketId: string | null; excluded: boolean };

// A transaction as the diagram sees it: `flow` is positive for money leaving, negative for money
// arriving, whatever sign its bank uses.
export type FlowTransaction = {
  id: string;
  date: string;
  description: string;
  bank: string;
  flow: number;
  timestamp: number;
};

// What stands behind a category's number.
export type CategorySource =
  | { kind: "line"; line: SankeyLineRecord | undefined }
  | { kind: "bank"; transactions: FlowTransaction[]; rule: SankeyRuleRecord | null };

export type PaycheckCheck = {
  // Whether any paycheck rule exists to find deposits.
  hasRule: boolean;
  // Paycheck lines (those with a last-paycheck amount): inflows and what came out of the check.
  gross: number;
  withheld: number;
  expectedNet: number;
  // Deposits the paycheck rules found in the year.
  deposits: number;
  depositTransactions: FlowTransaction[];
  difference: number;
  // "none": nothing entered or found yet. "ok": within tolerance. "mismatch": off by more than it.
  status: "none" | "ok" | "mismatch" | "missing-rule";
};

export type FlowInput = {
  year: number;
  buckets: SankeyBucketRecord[];
  categories: SankeyCategoryRecord[];
  lines: SankeyLineRecord[];
  rules: SankeyRuleRecord[];
  spendingBuckets: FlowSpendingBucket[];
  spendingCategories: FlowSpendingCategory[];
  banks: FlowBank[];
  transactions: FlowSourceTransaction[];
};

export type FlowResult = {
  // Every category to draw: the saved ones with their amounts filled in, plus derived ones for
  // spending buckets nobody linked, unclassified spending and bucket rules.
  categories: SankeyCategoryRecord[];
  sources: Map<string, CategorySource>;
  paycheck: PaycheckCheck;
};

export const UNCLASSIFIED_ID = "bank:unclassified";
export const UNGROUPED_ID = "bank:ungrouped";
export const bankCategoryId = (spendingBucketId: string) => `bank:${spendingBucketId}`;
export const ruleCategoryId = (ruleId: string) => `rule:${ruleId}`;

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

// A paycheck can't be exact against deposits for a year to date (timing, rounding, small
// reimbursements), so allow a little slack before calling it a mismatch.
export const PAYCHECK_TOLERANCE_MIN = 100;
export const PAYCHECK_TOLERANCE_RATE = 0.01;

/** Years with something to show: those with paycheck numbers plus those with transactions. */
export function availableYears(
  taxYears: number[],
  transactions: Pick<FlowSourceTransaction, "date">[],
  today: Date = new Date(),
): number[] {
  const years = new Set<number>([...taxYears, today.getFullYear()]);
  transactions.forEach((transaction) => {
    const parsed = parseDate(transaction.date);
    if (parsed) {
      years.add(parsed.getFullYear());
    }
  });
  return [...years].sort((a, b) => a - b);
}

export function matchRule(description: string, rules: SankeyRuleRecord[]): SankeyRuleRecord | null {
  const text = description.toLowerCase();
  for (const rule of [...rules].sort(byPosition)) {
    const pattern = rule.pattern.trim().toLowerCase();
    if (pattern !== "" && text.includes(pattern)) {
      return rule;
    }
  }
  return null;
}

// The Sankey bucket that holds spending: the one the user's linked categories already sit in,
// else the default "Spending" bucket, else the first outflow.
function spendingHome(
  buckets: SankeyBucketRecord[],
  categories: SankeyCategoryRecord[],
  spendingBuckets: FlowSpendingBucket[],
): string | null {
  const known = new Set(spendingBuckets.map((bucket) => bucket.id));
  const order = new Map(buckets.map((bucket) => [bucket.id, bucket.position]));
  const linked = categories
    .filter((category) => category.spendingBucketId !== null && known.has(category.spendingBucketId))
    .sort((a, b) => (order.get(a.bucketId) ?? 0) - (order.get(b.bucketId) ?? 0) || a.position - b.position)[0];
  if (linked) {
    return linked.bucketId;
  }
  const fallback = buckets.find((bucket) => bucket.id === "default-spending");
  if (fallback) {
    return fallback.id;
  }
  return buckets.filter((bucket) => bucket.direction === "outflow").sort(byPosition)[0]?.id ?? null;
}

export function resolveFlow(input: FlowInput): FlowResult {
  const { year, buckets, rules, spendingBuckets, spendingCategories, banks } = input;
  const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  const spendingBucketIds = new Set(spendingBuckets.map((bucket) => bucket.id));
  const categoryRecordById = new Map(spendingCategories.map((category) => [category.id, category]));
  const spendingPositive = new Map(
    banks.map((bank) => [normalizeBankName(bank.name), bank.spendingPositive] as const),
  );
  const linesByCategory = new Map(
    input.lines.filter((line) => line.year === year).map((line) => [line.categoryId, line] as const),
  );

  // --- Bucket the year's transactions ---
  const bankAmounts = new Map<string, number>();
  const bankTransactions = new Map<string, FlowTransaction[]>();
  const ruleKinds = new Map<string, number>();
  const ruleTransactions = new Map<string, FlowTransaction[]>();
  const depositTransactions: FlowTransaction[] = [];
  let deposits = 0;

  const add = (map: Map<string, number>, key: string, amount: number) =>
    map.set(key, (map.get(key) ?? 0) + amount);
  const push = (map: Map<string, FlowTransaction[]>, key: string, transaction: FlowTransaction) => {
    const list = map.get(key) ?? [];
    list.push(transaction);
    map.set(key, list);
  };

  for (const source of input.transactions) {
    const date = parseDate(source.date);
    if (!date || date.getFullYear() !== year) {
      continue;
    }
    const sign = spendingPositive.get(normalizeBankName(source.sourceBank)) ?? true ? 1 : -1;
    const transaction: FlowTransaction = {
      id: source.id,
      date: source.date,
      description: source.description,
      bank: source.sourceBank,
      flow: source.amount * sign,
      timestamp: date.getTime(),
    };

    // Rules first, so a brokerage transfer counts as an investment even though the spending page
    // files it under Transfers.
    const rule = matchRule(source.description, rules);
    if (rule?.kind === "paycheck") {
      deposits += -transaction.flow;
      depositTransactions.push(transaction);
      continue;
    }
    if (rule?.kind === "bucket" && rule.bucketId && bucketById.has(rule.bucketId)) {
      const target = bucketById.get(rule.bucketId)!;
      add(ruleKinds, rule.id, target.direction === "outflow" ? transaction.flow : -transaction.flow);
      push(ruleTransactions, rule.id, transaction);
      continue;
    }

    if (isTransferCategory(source.category)) {
      continue;
    }
    const record = categoryRecordById.get(source.category);
    if (record?.excluded) {
      continue;
    }
    const spendingBucketId = record?.bucketId ?? null;
    const key =
      spendingBucketId && spendingBucketIds.has(spendingBucketId)
        ? bankCategoryId(spendingBucketId)
        : record && source.category !== UNCLASSIFIED_CATEGORY
          ? UNGROUPED_ID
          : UNCLASSIFIED_ID;
    add(bankAmounts, key, transaction.flow);
    push(bankTransactions, key, transaction);
  }

  // --- Categories ---
  const sources = new Map<string, CategorySource>();
  const resolved: SankeyCategoryRecord[] = [];
  const claimed = new Set<string>();
  const home = spendingHome(buckets, input.categories, spendingBuckets);

  for (const category of [...input.categories].sort(byPosition)) {
    const linkedId =
      category.spendingBucketId && spendingBucketIds.has(category.spendingBucketId)
        ? category.spendingBucketId
        : null;
    if (linkedId) {
      // A spending bucket linked twice only counts once.
      const first = !claimed.has(linkedId);
      claimed.add(linkedId);
      const key = bankCategoryId(linkedId);
      resolved.push({ ...category, amount: first ? (bankAmounts.get(key) ?? 0) : 0 });
      sources.set(category.id, {
        kind: "bank",
        transactions: first ? (bankTransactions.get(key) ?? []) : [],
        rule: null,
      });
    } else {
      const line = linesByCategory.get(category.id);
      resolved.push({ ...category, amount: line?.ytd ?? 0 });
      sources.set(category.id, { kind: "line", line });
    }
  }

  const derived = (
    id: string,
    bucketId: string,
    name: string,
    spendingBucketId: string | null,
    position: number,
    amount: number,
    color?: string,
  ) => {
    resolved.push({ id, bucketId, name, spendingBucketId, amount, position, taxRole: "none", color });
  };

  if (home) {
    // Spending buckets nobody linked still count, so spending always ties to the spending page.
    for (const bucket of [...spendingBuckets].sort(byPosition)) {
      const key = bankCategoryId(bucket.id);
      if (claimed.has(bucket.id) || !bankTransactions.has(key)) {
        continue;
      }
      derived(key, home, bucket.name, bucket.id, 10_000 + bucket.position, bankAmounts.get(key) ?? 0);
      sources.set(key, { kind: "bank", transactions: bankTransactions.get(key) ?? [], rule: null });
    }
    if (bankTransactions.has(UNGROUPED_ID)) {
      derived(UNGROUPED_ID, home, "Ungrouped", null, 20_000, bankAmounts.get(UNGROUPED_ID) ?? 0, UNGROUPED_BUCKET_COLOR);
      sources.set(UNGROUPED_ID, { kind: "bank", transactions: bankTransactions.get(UNGROUPED_ID) ?? [], rule: null });
    }
    if (bankTransactions.has(UNCLASSIFIED_ID)) {
      derived(
        UNCLASSIFIED_ID,
        home,
        "Unclassified",
        null,
        20_001,
        bankAmounts.get(UNCLASSIFIED_ID) ?? 0,
        UNCLASSIFIED_BUCKET_COLOR,
      );
      sources.set(UNCLASSIFIED_ID, {
        kind: "bank",
        transactions: bankTransactions.get(UNCLASSIFIED_ID) ?? [],
        rule: null,
      });
    }
  }

  for (const rule of [...rules].sort(byPosition)) {
    if (rule.kind !== "bucket" || !rule.bucketId || !bucketById.has(rule.bucketId) || !ruleTransactions.has(rule.id)) {
      continue;
    }
    const id = ruleCategoryId(rule.id);
    derived(id, rule.bucketId, rule.name || rule.pattern, null, 30_000 + rule.position, ruleKinds.get(rule.id) ?? 0);
    sources.set(id, { kind: "bank", transactions: ruleTransactions.get(rule.id) ?? [], rule });
  }

  // --- Paycheck check ---
  // A line counts as part of the paycheck when it has a last-paycheck amount; interest and the
  // like are year-to-date only.
  let gross = 0;
  let withheld = 0;
  for (const category of input.categories) {
    const line = linesByCategory.get(category.id);
    if (!line || line.lastPaycheck === 0) {
      continue;
    }
    const direction = bucketById.get(category.bucketId)?.direction;
    if (direction === "inflow") {
      gross += line.ytd;
    } else if (direction === "outflow") {
      withheld += line.ytd;
    }
  }
  const expectedNet = gross - withheld;
  const hasRule = rules.some((rule) => rule.kind === "paycheck" && rule.pattern.trim() !== "");
  const difference = deposits - expectedNet;
  const tolerance = Math.max(PAYCHECK_TOLERANCE_MIN, Math.abs(expectedNet) * PAYCHECK_TOLERANCE_RATE);

  let status: PaycheckCheck["status"];
  if (gross === 0 && deposits === 0) {
    status = "none";
  } else if (!hasRule) {
    status = "missing-rule";
  } else {
    status = Math.abs(difference) <= tolerance ? "ok" : "mismatch";
  }

  return {
    categories: resolved,
    sources,
    paycheck: {
      hasRule,
      gross,
      withheld,
      expectedNet,
      deposits,
      depositTransactions: depositTransactions.sort((a, b) => b.timestamp - a.timestamp),
      difference,
      status,
    },
  };
}

// Transactions behind a bucket: all of its categories' bank transactions, newest first.
export function bucketTransactions(
  bucketId: string,
  categories: SankeyCategoryRecord[],
  sources: Map<string, CategorySource>,
): FlowTransaction[] {
  return categories
    .filter((category) => category.bucketId === bucketId)
    .flatMap((category) => {
      const source = sources.get(category.id);
      return source?.kind === "bank" ? source.transactions : [];
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}
