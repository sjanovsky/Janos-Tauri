import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildCashFlow, LEFTOVER_SEGMENT_ID } from "../../cashflow/lib/cashflow";
import type { BucketRecord, CategoryRecord } from "../../spending/lib/categories";
import type { PaychecksData } from "../../income/lib/income";
import type { UploadedFileView } from "../../upload/lib/uploads";

export type MonthCashFlow = { income: number; expenses: number };

const EMPTY_PAYCHECKS: PaychecksData = { paychecks: [], buckets: [], items: [] };

// Actual income and expenses per calendar month ("YYYY-MM"), from the same sources and rules as the
// Cash Flow page: income is gross pay, expenses are everything that left it (withholding and
// spending). Net income is the difference, so it matches Cash Flow's leftover.
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
    const columns = result.series.map((point) => point.key);
    const gross = result.rows.find((row) => row.kind === "gross");
    columns.forEach((month, index) => {
      // Group rows hold money out as negatives; Leftover isn't an expense.
      const expenses = result.rows
        .filter((row) => row.kind === "group")
        .flatMap((row) => row.children)
        .filter((child) => child.id !== LEFTOVER_SEGMENT_ID)
        .reduce((sum, child) => sum + child.perColumn[index], 0);
      byMonth.set(month, { income: gross?.perColumn[index] ?? 0, expenses: -expenses });
    });
    return byMonth;
  }, [uploads, categories, buckets, paychecks]);
}
