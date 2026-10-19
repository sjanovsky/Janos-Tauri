import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { wholeCurrencyFormatter } from "../spending/lib/format";
import { UNGROUPED_BUCKET_COLOR } from "../spending/lib/categories";
import type {
  AccountRecord,
  NetWorthBucketRecord,
} from "../networth/lib/networth";
import { PlusIcon, TrashIcon } from "../spending/BucketsAndCategories";
import {
  HIDDEN_ACCOUNTS_KEY,
  HIDDEN_PAYMENTS_KEY,
  parseHiddenItems,
  paymentKey,
  paymentMapping,
  type PaymentSource,
} from "./lib/planning";

const SOURCE_DRAG_TYPE = "application/x-janos-planning-payment";
const UNMAPPED = "unmapped";

type ForecastPaymentsProps = {
  sources: PaymentSource[];
  settings: Map<string, string>;
  // Save (or, with null, remove) one planning setting.
  onSetting: (key: string, value: string | null) => void;
};

// Maps planning lines (a paycheck's 401K, its match, the net income left over) to Net Worth
// accounts, in the style of the Settings boards: one row per account, with the lines dragged into
// it shown as pills. Forecasting adds each mapped line's yearly amount to its account as a payment.
function ForecastPayments({
  sources: allSources,
  settings,
  onSetting,
}: ForecastPaymentsProps) {
  const [addText, setAddText] = useState("");
  const [addAccountText, setAddAccountText] = useState("");
  const hidden = useMemo(
    () => parseHiddenItems(settings.get(HIDDEN_PAYMENTS_KEY)),
    [settings],
  );
  const sources = useMemo(
    () => allSources.filter((source) => !hidden.includes(source.key)),
    [allSources, hidden],
  );
  // The removed lines that can be added back; only these are accepted by the add field.
  const hiddenSources = useMemo(
    () => allSources.filter((source) => hidden.includes(source.key)),
    [allSources, hidden],
  );
  const addMatch = hiddenSources.find(
    (source) => source.name.toLowerCase() === addText.trim().toLowerCase(),
  );

  const saveHidden = (keys: string[]) =>
    onSetting(
      HIDDEN_PAYMENTS_KEY,
      keys.length > 0 ? JSON.stringify(keys) : null,
    );

  // Removing a line also stops its payment, so it comes back unmapped if it's added again.
  const removeSource = (key: string) => {
    onSetting(paymentKey(key), null);
    saveHidden([...hidden.filter((existing) => existing !== key), key]);
  };

  const addBack = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (addMatch) {
      saveHidden(hidden.filter((key) => key !== addMatch.key));
      setAddText("");
    }
  };

  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [buckets, setBuckets] = useState<NetWorthBucketRecord[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    const fail = (error: unknown) =>
      console.error("Failed to load net-worth accounts for payments", error);
    invoke<AccountRecord[]>("list_networth_accounts")
      .then(setAccounts)
      .catch(fail);
    invoke<NetWorthBucketRecord[]>("list_networth_buckets")
      .then(setBuckets)
      .catch(fail);
  }, []);

  const mapping = useMemo(
    () =>
      paymentMapping(
        sources,
        settings,
        new Set(accounts.map((account) => account.id)),
      ),
    [sources, settings, accounts],
  );

  // Accounts in their bucket order, so the rows follow the Net Worth page.
  const ordered = useMemo(() => {
    const bucketPosition = new Map(
      buckets.map((bucket) => [bucket.id, bucket.position]),
    );
    const bucketColor = new Map(
      buckets.map((bucket) => [bucket.id, bucket.color]),
    );
    return accounts
      .slice()
      .sort(
        (a, b) =>
          (bucketPosition.get(a.bucketId ?? "") ?? Infinity) -
            (bucketPosition.get(b.bucketId ?? "") ?? Infinity) ||
          a.position - b.position ||
          a.name.localeCompare(b.name),
      )
      .map((account) => ({
        account,
        color:
          bucketColor.get(account.bucketId ?? "") ?? UNGROUPED_BUCKET_COLOR,
      }));
  }, [accounts, buckets]);

  const hiddenAccounts = useMemo(
    () => parseHiddenItems(settings.get(HIDDEN_ACCOUNTS_KEY)),
    [settings],
  );
  const shownAccounts = ordered.filter(
    ({ account }) => !hiddenAccounts.includes(account.id),
  );
  const removedAccounts = accounts.filter((account) =>
    hiddenAccounts.includes(account.id),
  );
  const accountMatch = removedAccounts.find(
    (account) =>
      account.name.toLowerCase() === addAccountText.trim().toLowerCase(),
  );

  const saveHiddenAccounts = (ids: string[]) =>
    onSetting(HIDDEN_ACCOUNTS_KEY, ids.length > 0 ? JSON.stringify(ids) : null);

  // Removing an account unmaps its lines, so nothing keeps paying into it.
  const removeAccount = (accountId: string) => {
    sources
      .filter((source) => mapping.get(source.key) === accountId)
      .forEach((source) => onSetting(paymentKey(source.key), null));
    saveHiddenAccounts([
      ...hiddenAccounts.filter((id) => id !== accountId),
      accountId,
    ]);
  };

  const addAccountBack = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (accountMatch) {
      saveHiddenAccounts(hiddenAccounts.filter((id) => id !== accountMatch.id));
      setAddAccountText("");
    }
  };

  const place = (sourceKey: string, accountId: string | null) =>
    onSetting(paymentKey(sourceKey), accountId);

  const isDrag = (event: DragEvent<HTMLDivElement>) =>
    event.dataTransfer.types.includes(SOURCE_DRAG_TYPE) || dragging !== null;

  const clearDrag = () => {
    setDragging(null);
    setDragOver(null);
  };

  const rowHandlers = (key: string, accountId: string | null) => ({
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (isDrag(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOver(key);
      }
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDragOver((current) => (current === key ? null : current));
      }
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const sourceKey =
        event.dataTransfer.getData(SOURCE_DRAG_TYPE) || dragging;
      if (sourceKey) {
        place(sourceKey, accountId);
      }
      clearDrag();
    },
  });

  const renderPill = (source: PaymentSource) => (
    <div
      key={source.key}
      className={`cat-pill ${dragging === source.key ? "cat-pill--dragging" : ""}`}
      style={{ "--cat": source.color } as CSSProperties}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(SOURCE_DRAG_TYPE, source.key);
        event.dataTransfer.setData("text/plain", source.key);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setDragImage(event.currentTarget, 20, 16);
        setDragging(source.key);
      }}
      onDragEnd={clearDrag}
    >
      <span className="cat-pill__label">
        {source.name} · {wholeCurrencyFormatter.format(source.amount)}/yr
      </span>
      <button
        type="button"
        className="cat-pill__remove"
        aria-label={`Remove ${source.name}`}
        title={`Remove ${source.name} from this list`}
        onClick={() => removeSource(source.key)}
      >
        ×
      </button>
    </div>
  );

  const unmapped = sources.filter((source) => !mapping.has(source.key));

  return (
    <section className="category-manager planning-card planning-payments">
      <div className="category-manager__heading">
        <h2>Forecast payments</h2>
        <p>
          Drag a line into a bank account to have Forecasting add its yearly
          amount to that account each year. Drag it back to “Not mapped” to
          stop.
        </p>
      </div>

      {accounts.length === 0 ? (
        <p className="planning-payments__empty">
          Add accounts on the Net Worth page to map payments to them.
        </p>
      ) : (
        <div className="bucket-board">
          <div className="bucket-board__header">
            <span className="bucket-board__header-label">Account</span>
            <span className="bucket-board__header-label">Payments</span>
          </div>
          {shownAccounts.map(({ account, color }) => {
            const members = sources.filter(
              (source) => mapping.get(source.key) === account.id,
            );
            return (
              <div
                key={account.id}
                className={`bucket-row ${dragOver === account.id ? "bucket-row--drop" : ""}`}
                {...rowHandlers(account.id, account.id)}
              >
                <div className="bucket-row__head">
                  <span
                    className="planning-payments__dot"
                    style={{ background: color }}
                  />
                  <span className="bucket-row__name bucket-row__name--static">
                    {account.name}
                  </span>
                </div>
                <div className="bucket-row__items">
                  {members.length === 0 ? (
                    <span className="bucket-row__empty">Drag lines here</span>
                  ) : (
                    members.map(renderPill)
                  )}
                </div>
                <button
                  type="button"
                  className="import-shell__upload-delete bucket-row__delete"
                  aria-label={`Remove account ${account.name}`}
                  title="Remove this account from the list"
                  onClick={() => removeAccount(account.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            );
          })}
          <div
            className={`bucket-row bucket-row--ungrouped ${dragOver === UNMAPPED ? "bucket-row--drop" : ""}`}
            style={{ "--cat": UNGROUPED_BUCKET_COLOR } as CSSProperties}
            {...rowHandlers(UNMAPPED, null)}
          >
            <div className="bucket-row__head">
              <span className="bucket-row__name bucket-row__name--static">
                Not mapped
              </span>
            </div>
            <div className="bucket-row__items">
              {unmapped.length === 0 ? (
                <span className="bucket-row__empty">
                  Drop here to stop paying into an account
                </span>
              ) : (
                unmapped.map(renderPill)
              )}
            </div>
          </div>
        </div>
      )}

      {(removedAccounts.length > 0 || hiddenSources.length > 0) && (
        <div className="planning-payments__addbacks">
          {removedAccounts.length > 0 && (
            <form
              className="planning-payments__addback"
              onSubmit={addAccountBack}
            >
              <div className="bucket-board__field">
                <input
                  type="text"
                  list="planning-hidden-accounts"
                  className="category-manager__label-input"
                  placeholder="Add a removed account back"
                  aria-label="Add a removed account back"
                  value={addAccountText}
                  onChange={(event) => setAddAccountText(event.target.value)}
                />
                <datalist id="planning-hidden-accounts">
                  {removedAccounts.map((account) => (
                    <option key={account.id} value={account.name} />
                  ))}
                </datalist>
                {accountMatch && (
                  <button
                    type="submit"
                    className="bucket-board__add-btn"
                    aria-label="Add account"
                    title="Add account"
                  >
                    <PlusIcon />
                  </button>
                )}
              </div>
            </form>
          )}

          {hiddenSources.length > 0 && (
            <form className="planning-payments__addback" onSubmit={addBack}>
              <div className="bucket-board__field">
                <input
                  type="text"
                  list="planning-hidden-payments"
                  className="category-manager__label-input"
                  placeholder="Add a removed line back"
                  aria-label="Add a removed line back"
                  value={addText}
                  onChange={(event) => setAddText(event.target.value)}
                />
                <datalist id="planning-hidden-payments">
                  {hiddenSources.map((source) => (
                    <option key={source.key} value={source.name} />
                  ))}
                </datalist>
                {addMatch && (
                  <button
                    type="submit"
                    className="bucket-board__add-btn"
                    aria-label="Add line"
                    title="Add line"
                  >
                    <PlusIcon />
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

export default ForecastPayments;
