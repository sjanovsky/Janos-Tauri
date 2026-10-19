import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CategoryRecord } from "../../spending/lib/categories";
import type { UploadedFileView } from "../../upload/lib/uploads";
import type { PaychecksData } from "../../income/lib/income";
import type { TaxesData } from "../../taxes/lib/taxes";
import {
  SAVINGS_GROUP_ID,
  TAXES_GROUP_ID,
  paycheckItemKey,
  placementMap,
  resolveGroupId,
  type CashflowData,
} from "../../cashflow/lib/groups";
import {
  SECTIONS_KEY,
  SPENDING_KEY,
  defaultSections,
  estimatedTaxes,
  parseAmount,
  expandBucketSources,
  HIDDEN_ITEMS_KEY,
  parseHiddenItems,
  parseSections,
  planPaycheck,
  planningTotals,
  spendingHistory,
  type PlanningSection,
  type PlanningSettingRecord,
} from "./planning";

export const PLANNING_DB_ERROR =
  "Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.";

// Everything the Planning page works from, loaded once: the other pages' data, the saved overrides,
// and the plans and totals computed from them. Shared with the pages that use Planning's numbers
// (the net-worth projection and Forecasting).
export function usePlanning() {
  const [paychecks, setPaychecks] = useState<PaychecksData>({ paychecks: [], buckets: [], items: [] });
  const [taxes, setTaxes] = useState<TaxesData>({ years: [], items: [], householdValues: [] });
  const [uploads, setUploads] = useState<UploadedFileView[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [settingRecords, setSettingRecords] = useState<PlanningSettingRecord[]>([]);
  const [cashflow, setCashflow] = useState<CashflowData>({ groups: [], members: [] });
  const [loaded, setLoaded] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const reloadSettings = useCallback(
    () =>
      invoke<PlanningSettingRecord[]>("get_planning_settings")
        .then(setSettingRecords)
        .catch((error) => {
          console.error("Failed to load planning settings", error);
          setDbError(PLANNING_DB_ERROR);
        }),
    [],
  );

  useEffect(() => {
    const fail = (what: string) => (error: unknown) => {
      console.error(`Failed to load ${what} from the database`, error);
      setDbError(PLANNING_DB_ERROR);
    };
    void Promise.all([
      invoke<PaychecksData>("get_paychecks_data").then(setPaychecks).catch(fail("paychecks")),
      invoke<TaxesData>("get_taxes_data").then(setTaxes).catch(fail("taxes")),
      invoke<UploadedFileView[]>("list_uploads").then(setUploads).catch(fail("uploads")),
      invoke<CategoryRecord[]>("list_categories").then(setCategories).catch(fail("categories")),
      invoke<CashflowData>("get_cashflow_data").then(setCashflow).catch(fail("cash flow groups")),
      reloadSettings(),
    ]).then(() => setLoaded(true));
  }, [reloadSettings]);

  const settings = useMemo(
    () => new Map(settingRecords.map((record) => [record.key, record.value] as const)),
    [settingRecords],
  );

  // Save (or, with null, remove) one override; roll back by reloading if the write fails.
  const setSetting = (key: string, value: string | null) => {
    setSettingRecords((current) => {
      const rest = current.filter((record) => record.key !== key);
      return value === null ? rest : [...rest, { key, value }];
    });
    const write =
      value === null
        ? invoke("delete_planning_setting", { key })
        : invoke("set_planning_setting", { key, value });
    write.catch((error) => {
      console.error(`Failed to save (${key})`, error);
      setDbError(PLANNING_DB_ERROR);
      void reloadSettings();
    });
  };

  // Bonus and commission live on the paycheck itself; save it and roll back by reloading on failure.
  const setExtraIncome = (paycheckId: string, extraIncome: number) => {
    const paycheck = paychecks.paychecks.find((candidate) => candidate.id === paycheckId);
    if (!paycheck) {
      return;
    }
    setPaychecks((current) => ({
      ...current,
      paychecks: current.paychecks.map((candidate) =>
        candidate.id === paycheckId ? { ...candidate, extraIncome } : candidate,
      ),
    }));
    invoke("upsert_paycheck", {
      id: paycheck.id,
      name: paycheck.name,
      depositPattern: paycheck.depositPattern,
      color: paycheck.color,
      paychecksPerYear: paycheck.paychecksPerYear,
      extraIncome,
    }).catch((error) => {
      console.error("Failed to save bonus and commission", error);
      setDbError(PLANNING_DB_ERROR);
      setPaychecks((current) => ({
        ...current,
        paychecks: current.paychecks.map((candidate) => (candidate.id === paycheckId ? paycheck : candidate)),
      }));
    });
  };

  // The paycheck buckets Cash Flow puts in a group; they are where the default sections start.
  const bucketsInGroup = useMemo(() => {
    const placements = placementMap(cashflow.members);
    const groupIds = new Set(cashflow.groups.map((group) => group.id));
    return (groupId: string) =>
      paychecks.buckets
        .filter(
          (bucket) =>
            resolveGroupId({ key: paycheckItemKey(bucket.id), name: bucket.name }, placements, groupIds) === groupId,
        )
        .map((bucket) => bucket.id);
  }, [cashflow, paychecks.buckets]);

  // The saved sections, or Taxes and Retirement built from Cash Flow until the user saves a layout.
  const sections = useMemo<PlanningSection[]>(() => {
    const groupColor = (groupId: string, fallback: string) =>
      cashflow.groups.find((group) => group.id === groupId)?.color ?? fallback;
    const saved = parseSections(settings.get(SECTIONS_KEY));
    return (
      (saved && expandBucketSources(saved, paychecks.items)) ??
      defaultSections(paychecks.items, bucketsInGroup(TAXES_GROUP_ID), bucketsInGroup(SAVINGS_GROUP_ID), {
        taxes: groupColor(TAXES_GROUP_ID, "#6a9fc9"),
        retirement: groupColor(SAVINGS_GROUP_ID, "#4f8a68"),
      })
    );
  }, [settings, cashflow.groups, paychecks.items, bucketsInGroup]);

  const hiddenItems = useMemo(() => parseHiddenItems(settings.get(HIDDEN_ITEMS_KEY)), [settings]);
  const saveHiddenItems = (ids: string[]) => setSetting(HIDDEN_ITEMS_KEY, ids.length > 0 ? JSON.stringify(ids) : null);

  const saveSections = (next: PlanningSection[]) => setSetting(SECTIONS_KEY, JSON.stringify(next));

  const plans = useMemo(
    () =>
      paychecks.paychecks.map((paycheck) =>
        planPaycheck(paycheck, paychecks.items, paychecks.buckets, settings, sections),
      ),
    [paychecks, settings, sections],
  );

  // The Taxes page's federal estimate, shown for reference next to the paycheck-based taxes.
  const taxesDefault = useMemo(() => estimatedTaxes(taxes, new Date().getFullYear()), [taxes]);
  const history = useMemo(
    () =>
      spendingHistory(
        uploads.flatMap((upload) => upload.transactions),
        categories,
        paychecks.paychecks,
        new Date(),
      ),
    [uploads, categories, paychecks.paychecks],
  );

  // Spending defaults to the trailing average; it can be typed over.
  const spendingPulled = history.trailingAnnualized;
  const typedSpending = parseAmount(settings.get(SPENDING_KEY) ?? "");
  const spendingValue = typedSpending ?? spendingPulled;
  const totals = planningTotals(plans, sections, spendingValue);

  return {
    paychecks,
    cashflow,
    settings,
    loaded,
    dbError,
    setDbError,
    setSetting,
    setExtraIncome,
    sections,
    saveSections,
    hiddenItems,
    saveHiddenItems,
    plans,
    taxesDefault,
    history,
    spendingPulled,
    typedSpending,
    spendingValue,
    totals,
  };
}
