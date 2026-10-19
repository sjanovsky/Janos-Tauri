import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { computeDivergingScale } from "../spending/lib/chartScale";
import NetWorthChart from "./NetWorthChart";
import { useNetWorthAccounts } from "./lib/useNetWorthAccounts";
import { useNetWorthCashFlow } from "./lib/useNetWorthCashFlow";
import NetWorthManageModal, { type NetWorthManageTab } from "./NetWorthManageModal";
import { type ImportPayload } from "./NetWorthImportModal";
import {
  addMonth,
  buildNetWorthView,
  buildNetWorthYearlyView,
  currentMonth,
  formatMonthAxis,
  sortedUniqueMonths,
  type AccountRecord,
  type BalanceRecord,
  type ChartColumn,
  type NetWorthBucketRecord,
  type NetWorthRange,
} from "./lib/networth";

const DB_ERROR = "Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.";

// The Net Worth page: a stacked-bar chart of monthly net worth over an editable grid of per-account
// balances, plus an Accounts & buckets manager (in a modal). Owns all state and persists every
// change through the networth Tauri commands with optimistic updates (mirroring SpendingPage).
function NetWorthPage() {
  const [buckets, setBuckets] = useState<NetWorthBucketRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [balances, setBalances] = useState<BalanceRecord[]>([]);
  // Empty month columns the user added that don't (yet) have any balances. Seeded with the current
  // month so there's always somewhere to record the latest balance. Session-only: a stray add
  // disappears on reload, and months with real data always come from `balances`.
  const [extraMonths, setExtraMonths] = useState<string[]>(() => [currentMonth()]);
  // The manage modal is closed when null, otherwise open to the named tab.
  const [manageTab, setManageTab] = useState<NetWorthManageTab | null>(null);
  // Whether the chart groups its columns by month (editable grid) or by year (read-only overview).
  const [range, setRange] = useState<NetWorthRange>("month");
  const [dbError, setDbError] = useState<string | null>(null);

  const loadBuckets = useCallback(
    () =>
      invoke<NetWorthBucketRecord[]>("list_networth_buckets")
        .then(setBuckets)
        .catch((error) => {
          console.error("Failed to load net-worth buckets from the database", error);
          setDbError(DB_ERROR);
        }),
    [],
  );

  const loadAccounts = useCallback(
    () =>
      invoke<AccountRecord[]>("list_networth_accounts")
        .then(setAccounts)
        .catch((error) => {
          console.error("Failed to load accounts from the database", error);
          setDbError(DB_ERROR);
        }),
    [],
  );

  const loadBalances = useCallback(
    () =>
      invoke<BalanceRecord[]>("list_networth_balances")
        .then(setBalances)
        .catch((error) => {
          console.error("Failed to load balances from the database", error);
          setDbError(DB_ERROR);
        }),
    [],
  );

  useEffect(() => {
    void loadBuckets();
    void loadAccounts();
    void loadBalances();
  }, [loadBuckets, loadAccounts, loadBalances]);

  // The months that have at least one entered balance, sorted ascending.
  const enteredMonths = useMemo(() => {
    const unique = Array.from(new Set(balances.map((balance) => balance.month)));
    unique.sort();
    return unique;
  }, [balances]);

  // How many entered balances each month holds, so the Months panel can warn before deleting data.
  const balanceCountByMonth = useMemo(() => {
    const counts: Record<string, number> = {};
    balances.forEach((balance) => {
      counts[balance.month] = (counts[balance.month] ?? 0) + 1;
    });
    return counts;
  }, [balances]);

  // The visible columns: one per distinct month that has a balance or was added, sorted ascending.
  // No gap-filling — only the months the user actually has or asked for. Always at least one column.
  const months = useMemo(() => {
    const union = sortedUniqueMonths([...enteredMonths, ...extraMonths]);
    return union.length > 0 ? union : [currentMonth()];
  }, [enteredMonths, extraMonths]);

  // A column can be removed again while it holds no balances (and isn't the only column left).
  const removableMonths = useMemo(() => {
    if (months.length <= 1) {
      return new Set<string>();
    }
    const entered = new Set(enteredMonths);
    return new Set(months.filter((month) => !entered.has(month)));
  }, [months, enteredMonths]);

  const view = useMemo(
    () => buildNetWorthView(buckets, accounts, balances, months),
    [buckets, accounts, balances, months],
  );

  // One editable column per month: a single full-width bar above each month's balance cells.
  const monthColumns = useMemo<ChartColumn[]>(
    () =>
      months.map((month, index) => ({
        key: month,
        label: formatMonthAxis(month),
        bars: [view.series[index]],
        editable: true,
        month,
        removable: removableMonths.has(month),
        barIndex: null,
      })),
    [months, view.series, removableMonths],
  );

  // The Years view is derived from the same balances, so only recompute it while that view is active.
  const yearly = useMemo(
    () => (range === "year" ? buildNetWorthYearlyView(buckets, accounts, balances, months, currentMonth()) : null),
    [range, buckets, accounts, balances, months],
  );

  // The columns, grid data, and bar series the chart actually renders, chosen by the active range.
  // `scaleSeries` is what the diverging scale is sized from — the monthly points in both views (a
  // year's bars are its months), so the y-axis matches the bars regardless of range.
  const columns = range === "year" ? yearly!.columns : monthColumns;
  const gridGroups = range === "year" ? yearly!.groups : view.groups;
  const gridNetPerColumn = range === "year" ? yearly!.netPerColumn : view.netPerColumn;
  const scaleSeries = range === "year" ? yearly!.monthlySeries : view.series;

  const scale = useMemo(
    () =>
      computeDivergingScale(
        scaleSeries.map((point) => {
          const positiveTotal = point.segments
            .filter((segment) => segment.value > 0)
            .reduce((sum, segment) => sum + segment.value, 0);
          const negativeTotal = point.segments
            .filter((segment) => segment.value < 0)
            .reduce((sum, segment) => sum + Math.abs(segment.value), 0);
          return { positiveTotal, negativeTotal };
        }),
      ),
    [scaleSeries],
  );

  const hasData = balances.length > 0;

  // Actual income and expenses under the Net worth row. A month column shows that month; a Years
  // column shows its calendar year up to that column's month (so the current year is year-to-date).
  const monthlyCashFlow = useNetWorthCashFlow();
  const cashFlowPerColumn = useMemo(
    () =>
      columns.map((column) => {
        const end = column.key;
        const start = range === "year" ? `${end.slice(0, 4)}-01` : end;
        let income = 0;
        let expenses = 0;
        monthlyCashFlow.forEach((value, month) => {
          if (month >= start && month <= end) {
            income += value.income;
            expenses += value.expenses;
          }
        });
        return { income, expenses, net: income - expenses };
      }),
    [columns, range, monthlyCashFlow],
  );

  const accountsProps = useNetWorthAccounts({
    buckets,
    setBuckets,
    accounts,
    setAccounts,
    onError: () => setDbError(DB_ERROR),
    onAccountRemoved: (id) => {
      const previous = balances;
      setBalances((current) => current.filter((balance) => balance.accountId !== id));
      return () => setBalances(previous);
    },
  });

  // --- Balances ---

  const handleSetBalance = (accountId: string, month: string, amount: number | null) => {
    const previous = balances;
    setBalances((current) => {
      const without = current.filter(
        (balance) => !(balance.accountId === accountId && balance.month === month),
      );
      return amount === null ? without : [...without, { accountId, month, amount }];
    });

    invoke("set_networth_balance", { accountId, month, amount }).catch((error) => {
      console.error("Failed to save the balance", error);
      setDbError(DB_ERROR);
      setBalances(previous);
    });
  };

  // --- Import ---

  // Persist a pasted-spreadsheet import in one batch, then reload so the new buckets, accounts, and
  // balances appear in the grid. Resolves to null on success, or the backend's error string so the
  // modal can show exactly what went wrong (rather than the generic DB banner).
  const handleImport = async (payload: ImportPayload): Promise<string | null> => {
    try {
      await invoke("import_networth", payload);
      await Promise.all([loadBuckets(), loadAccounts(), loadBalances()]);
      setManageTab(null);
      return null;
    } catch (error) {
      console.error("Failed to import net-worth data", error);
      return typeof error === "string" ? error : error instanceof Error ? error.message : JSON.stringify(error);
    }
  };

  // --- Months ---

  // Add exactly one new, empty column. It defaults to the month after the latest existing column
  // (skipping any that already exist); the user can then click its date to set the month they want.
  const handleAddMonth = () => {
    const existing = new Set(months);
    let candidate = addMonth(months[months.length - 1] ?? currentMonth(), 1);
    while (existing.has(candidate)) {
      candidate = addMonth(candidate, 1);
    }
    setExtraMonths((current) => [...current, candidate]);
  };

  const handleRemoveMonth = (month: string) => {
    setExtraMonths((current) => current.filter((value) => value !== month));
  };

  // Add one empty column immediately before the earliest existing month.
  const handleAddMonthBefore = () => {
    const target = addMonth(months[0] ?? currentMonth(), -1);
    setExtraMonths((current) =>
      months.includes(target) || current.includes(target) ? current : [...current, target],
    );
  };

  // Bulk-add every month in [start, end] (inclusive) that isn't already a column. Capped so a
  // reversed or absurd range can't spin up thousands of columns.
  const handleAddMonthRange = (start: string, end: string) => {
    const [from, to] = start <= end ? [start, end] : [end, start];
    const existing = new Set(months);
    const toAdd: string[] = [];
    let cursor = from;
    for (let guard = 0; cursor <= to && guard < 1200; guard += 1) {
      if (!existing.has(cursor)) {
        toAdd.push(cursor);
      }
      cursor = addMonth(cursor, 1);
    }
    if (toAdd.length > 0) {
      setExtraMonths((current) => Array.from(new Set([...current, ...toAdd])));
    }
  };

  // Delete a whole month column: drop it from the added columns and, if it holds entered balances,
  // remove those from the database (optimistically, rolling back on failure).
  const handleDeleteMonth = (month: string) => {
    setExtraMonths((current) => current.filter((value) => value !== month));
    if (!balances.some((balance) => balance.month === month)) {
      return;
    }
    const previous = balances;
    setBalances((current) => current.filter((balance) => balance.month !== month));
    invoke("delete_networth_month", { month }).catch((error) => {
      console.error("Failed to delete the month", error);
      setDbError(DB_ERROR);
      setBalances(previous);
    });
  };

  // Change which month a column represents (clicking its date). Rejected if the target month is
  // already a column, so two columns never collapse onto each other. Any balances in the column
  // move to the new month.
  const handleEditMonth = (oldMonth: string, newMonth: string) => {
    if (!newMonth || newMonth === oldMonth || months.includes(newMonth)) {
      return;
    }
    const previousBalances = balances;
    const previousExtra = extraMonths;
    setBalances((current) =>
      current.map((balance) => (balance.month === oldMonth ? { ...balance, month: newMonth } : balance)),
    );
    setExtraMonths((current) =>
      Array.from(new Set(current.map((month) => (month === oldMonth ? newMonth : month)))),
    );

    invoke("rename_networth_month", { oldMonth, newMonth }).catch((error) => {
      console.error("Failed to change the month", error);
      setDbError(DB_ERROR);
      setBalances(previousBalances);
      setExtraMonths(previousExtra);
    });
  };

  return (
    <>
      {dbError && <div className="import-shell__db-error">{dbError}</div>}
      <section className="import-shell__panel">
        <div className="networth-layout">
          <NetWorthChart
            hasAccounts={accounts.length > 0}
            hasData={hasData}
            range={range}
            columns={columns}
            monthlyBars={yearly?.monthlySeries ?? []}
            scale={scale}
            groups={gridGroups}
            netPerColumn={gridNetPerColumn}
            cashFlowPerColumn={cashFlowPerColumn}
            onRangeChange={setRange}
            onSetBalance={handleSetBalance}
            onEditMonth={handleEditMonth}
            onRemoveMonth={handleRemoveMonth}
            onOpenSettings={() => setManageTab("accounts")}
            onOpenImport={() => setManageTab("upload")}
          />
        </div>
      </section>

      {manageTab && (
        <NetWorthManageModal
          initialTab={manageTab}
          onClose={() => setManageTab(null)}
          upload={{ buckets, accounts, onImport: handleImport }}
          months={{
            months,
            balanceCountByMonth,
            onAddBefore: handleAddMonthBefore,
            onAddAfter: handleAddMonth,
            onAddRange: handleAddMonthRange,
            onDeleteMonth: handleDeleteMonth,
          }}
          accounts={accountsProps}
        />
      )}
    </>
  );
}

export default NetWorthPage;
