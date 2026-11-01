import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildCashFlow, spendingSegmentId } from "../../cashflow/lib/cashflow";
import type { BucketRecord, CategoryRecord } from "../../spending/lib/categories";
import type { PaychecksData } from "../../income/lib/income";
import type { UploadedFileView } from "../../upload/lib/uploads";

// One month: the paycheck deposits that landed and everything spent (positive).
export type MonthCashFlow = { paycheck: number; spending: number };

const SPENDING_PREFIX = spendingSegmentId("");

const EMPTY_PAYCHECKS: PaychecksData = { paychecks: [], buckets: [], items: [] };

// Actual paycheck deposits (take-home, not gross) and total spending per calendar month
// ("YYYY-MM"), from the same sources and rules as the Cash Flow page. Spending is every spending
// bucket together; withheld amounts (taxes, retirement) aren't spending, they never reach the bank.
export function useNetWorthCashFlow(): Map<string, MonthCashFlow> {
  const [uploads, setUploads] = useState<UploadedFileView[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [paychecks, setPaychecks] = useState<PaychecksData>(EMPTY_PAYCHECKS);

  useEffect(() => {
    // The grid still works without these; the income rows just stay empty.
    const fail = (what: string) => (error: unknown) =>
      console.error(`Failed to load ${what} for the net-worth cash flow rows`, error);
    invoke<UploadedFileView[]>("list_uploads").then(setUploads).catch(fail("uploads"));
    invoke<CategoryRecord[]>("list_categories").then(setCategories).catch(fail("categories"));
    invoke<BucketRecord[]>("list_buckets").then(setBuckets).catch(fail("buckets"));
    invoke<PaychecksData>("get_paychecks_data").then(setPaychecks).catch(fail("paychecks"));
  }, []);

  return useMemo(() => {
    const result = buildCashFlow({
      transactions: uploads.flatMap((upload) => upload.transactions),
      range: "month",
      paychecks: paychecks.paychecks,
      paycheckBuckets: paychecks.buckets,
      paycheckItems: paychecks.items,
      spendingBuckets: buckets,
      spendingCategories: categories,
      banks: [],
      groups: [],
      members: [],
    });
    const byMonth = new Map<string, MonthCashFlow>();
    // With no groups, every bucket lands in one row whose children are the individual buckets;
    // the spending ones are the money spent.
    const spendingLines = result.rows
      .filter((row) => row.kind === "group")
      .flatMap((row) => row.children)
      .filter((child) => child.id.startsWith(SPENDING_PREFIX));
    result.series.forEach((point, index) => {
      byMonth.set(point.key, {
        paycheck: result.depositPerColumn[index],
        spending: -spendingLines.reduce((sum, line) => sum + line.perColumn[index], 0),
      });
    });
    return byMonth;
  }, [uploads, categories, buckets, paychecks]);
}
