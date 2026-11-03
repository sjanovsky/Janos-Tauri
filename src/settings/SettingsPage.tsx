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
import InlineAdd from "../spending/InlineAdd";
import { BUCKET_COLOR_PALETTE } from "../spending/lib/categories";
import {
  NO_GROUP_ID,
  PAYCHECK_GROUP_ID,
  paycheckItemKey,
  spendingItemKey,
  type CashflowData,
  type CashflowGroupRecord,
  type CashflowMemberRecord,
} from "../cashflow/lib/groups";
import "./settings.css";

const PAYCHECK_PREFIX = paycheckItemKey("");
const SPENDING_PREFIX = spendingItemKey("");
const EMPTY_PAYCHECKS: PaychecksData = { paychecks: [], buckets: [], items: [] };

type BucketKind = "spending" | "paycheck";

// The one "new bucket" field at the bottom of a group.
function GroupAddBucket({ onAdd }: { onAdd: (name: string) => void }) {
  return (
    <div className="settings-group-add">
      <InlineAdd placeholder="+ Add bucket to this group" onAdd={onAdd} />
    </div>
  );
}

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

  // New buckets land in their kind's group (see defaultGroupId), so nothing needs placing.
  const addBucket = (kind: BucketKind, name: string) => {
    if (kind === "spending") {
      spendingProps.onAddBucket(name);
    } else {
      paycheckProps.onSaveBucket({
        id: crypto.randomUUID(),
        name,
        color: BUCKET_COLOR_PALETTE[paychecks.buckets.length % BUCKET_COLOR_PALETTE.length],
      });
    }
  };

  const bucketIds = new Set(buckets.map((bucket) => bucket.id));
  const paycheckBucketIds = new Set(paychecks.buckets.map((bucket) => bucket.id));
  const nothingUngrouped =
    !categoryRecords.some((category) => !category.excluded && !(category.bucketId && bucketIds.has(category.bucketId))) &&
    !paychecks.items.some((item) => !(item.bucketId && paycheckBucketIds.has(item.bucketId))) &&
    !cashflowProps.items.some((item) => (cashflowProps.groupOfItem.get(item.key) ?? NO_GROUP_ID) === NO_GROUP_ID);

  return (
    <div className="settings-page">
      <div className="settings-page__heading">
        <h1>Settings</h1>
        <p>Every bucket, category and group used across Janos, in one place.</p>
      </div>
      {error && <div className="import-shell__db-error">{error}</div>}

      <CashFlowGroups
        {...cashflowProps}
        title="Cash Flow"
        itemsLabel="Buckets"
        nestedHeaders={["Buckets", "Categories"]}
        description={
          <>
            Your paycheck buckets roll up into Paycheck and your spending buckets into Spending on the
            Cash Flow chart. Drag a bucket by its handle to reorder it, and a category or line item
            between buckets to regroup it. Drag “Leftover” into a group to count what's left each
            month as that group's money; leave it out and it shows as Net income.
          </>
        }
        isNestedKey={(key) => key.startsWith(PAYCHECK_PREFIX) || key.startsWith(SPENDING_PREFIX)}
        renderNested={(groupId, keys) => {
          const idsWith = (prefix: string) =>
            keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
          const paycheckIds = idsWith(PAYCHECK_PREFIX);
          const spendingIds = idsWith(SPENDING_PREFIX);
          return (
            <div className="settings-nested" key={groupId}>
              {paycheckIds.length > 0 && (
                <PaycheckBucketsBoard
                  {...paycheckProps}
                  part="buckets"
                  inline
                  onlyBucketIds={paycheckIds}
                />
              )}
              {spendingIds.length > 0 && (
                <BucketsAndCategories
                  {...spendingProps}
                  part="buckets"
                  inline
                  onlyBucketIds={spendingIds}
                />
              )}
              {groupId !== NO_GROUP_ID && (
                <GroupAddBucket onAdd={(name) => addBucket(groupId === PAYCHECK_GROUP_ID ? "paycheck" : "spending", name)} />
              )}
            </div>
          );
        }}
        ungroupedContent={
          <>
            <PaycheckBucketsBoard {...paycheckProps} part="ungrouped" />
            <BucketsAndCategories {...spendingProps} part="ungrouped" />
            {nothingUngrouped && (
              <span className="bucket-row__empty">
                Drop a bucket, category or line item here to take it out of its group
              </span>
            )}
          </>
        }
        endRows={<BucketsAndCategories {...spendingProps} part="exclude" />}
      />

      <AccountsAndBuckets {...netWorthProps} inline />
    </div>
  );
}

export default SettingsPage;
