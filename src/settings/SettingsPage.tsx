import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import BucketsAndCategories from "../spending/BucketsAndCategories";
import AccountsAndBuckets from "../networth/AccountsAndBuckets";
import CashFlowGroups from "../cashflow/CashFlowGroups";
import { PaycheckBucketsBoard } from "../income/LineItemsManager";
import { usePaycheckLineItems } from "../income/lib/usePaycheckLineItems";
import { useBucketsAndCategories } from "../spending/lib/useBucketsAndCategories";
import { useNetWorthAccounts } from "../networth/lib/useNetWorthAccounts";
import { useCashflowGroups } from "../cashflow/lib/useCashflowGroups";
import type { BucketRecord, CategoryRecord } from "../spending/lib/categories";
import type { PaychecksData } from "../income/lib/income";
import type { AccountRecord, NetWorthBucketRecord } from "../networth/lib/networth";
import type { CashflowData, CashflowGroupRecord, CashflowMemberRecord } from "../cashflow/lib/groups";
import "./settings.css";

const EMPTY_PAYCHECKS: PaychecksData = { paychecks: [], buckets: [], items: [] };

// The one place to see and edit every bucket, category and group the app uses. Each section is the
// same editor as that page's own Manage dialog, so edits made here show up there and vice versa.
function SettingsPage() {
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>([]);
  const [paychecks, setPaychecks] = useState<PaychecksData>(EMPTY_PAYCHECKS);
  const [nwBuckets, setNwBuckets] = useState<NetWorthBucketRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [groups, setGroups] = useState<CashflowGroupRecord[]>([]);
  const [members, setMembers] = useState<CashflowMemberRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fail = (what: string) => (e: unknown) => {
      console.error(`Failed to load ${what} from the database`, e);
      setError("Couldn't load buckets and categories from the database.");
    };
    invoke<BucketRecord[]>("list_buckets").then(setBuckets).catch(fail("buckets"));
    invoke<CategoryRecord[]>("list_categories").then(setCategoryRecords).catch(fail("categories"));
    invoke<PaychecksData>("get_paychecks_data").then(setPaychecks).catch(fail("paychecks"));
    invoke<NetWorthBucketRecord[]>("list_networth_buckets").then(setNwBuckets).catch(fail("net worth buckets"));
    invoke<AccountRecord[]>("list_networth_accounts").then(setAccounts).catch(fail("accounts"));
    invoke<CashflowData>("get_cashflow_data")
      .then((data) => {
        setGroups(data.groups);
        setMembers(data.members);
      })
      .catch(fail("cash flow groups"));
  }, []);

  const spendingProps = useBucketsAndCategories({
    buckets,
    setBuckets,
    categoryRecords,
    setCategoryRecords,
    onError: setError,
  });
  const paycheckProps = usePaycheckLineItems({
    buckets: paychecks.buckets,
    setBuckets: (action) =>
      setPaychecks((data) => ({
        ...data,
        buckets: typeof action === "function" ? action(data.buckets) : action,
      })),
    items: paychecks.items,
    setItems: (action) =>
      setPaychecks((data) => ({
        ...data,
        items: typeof action === "function" ? action(data.items) : action,
      })),
    onError: setError,
  });
  const netWorthProps = useNetWorthAccounts({
    buckets: nwBuckets,
    setBuckets: setNwBuckets,
    accounts,
    setAccounts,
    onError: () => setError("Couldn't save that change to the database."),
  });
  const cashflowProps = useCashflowGroups({
    paycheckBuckets: paychecks.buckets,
    buckets,
    groups,
    setGroups,
    members,
    setMembers,
    onError: setError,
  });

  return (
    <div className="settings-page">
      <div className="settings-page__heading">
        <h1>Settings</h1>
        <p>Every bucket, category and group used across Janos, in one place.</p>
      </div>
      {error && <div className="import-shell__db-error">{error}</div>}

      <BucketsAndCategories {...spendingProps} />

      <PaycheckBucketsBoard {...paycheckProps} />

      <AccountsAndBuckets {...netWorthProps} />

      <CashFlowGroups {...cashflowProps} />
    </div>
  );
}

export default SettingsPage;
