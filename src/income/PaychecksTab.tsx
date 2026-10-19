import {
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { softenColor } from "../spending/lib/categories";
import NumberField from "../taxes/NumberField";
import type { ImportedTransaction } from "../upload/lib/csvParser";
import LineItemsManager from "./LineItemsManager";
import {
  UNGROUPED_ITEMS_BUCKET_ID,
  currentVersion,
  datedVersions,
  expectedNet,
  matchesExpectedNet,
  paycheckItemAmount,
  paycheckSubtotal,
  resolveVersion,
  toIsoDate,
  type DepositCheck,
  type PaycheckBucketRecord,
  type PaycheckItemRecord,
  type PaycheckRecord,
  type PaycheckVersionRecord,
} from "./lib/income";
import "./income.css";

type PaychecksTabProps = {
  paychecks: PaycheckRecord[];
  buckets: PaycheckBucketRecord[];
  items: PaycheckItemRecord[];
  // Income-signed deposits (positive = money in) filed under income categories.
  deposits: ImportedTransaction[];
  // The paycheck whose deposits the transaction list shows (null = all), and how to change it.
  selectedPaycheckId: string | null;
  onSelectPaycheck: (id: string | null) => void;
  onAddPaycheck: (name: string) => string;
  onUpdatePaycheck: (
    id: string,
    patch: Partial<
      Pick<
        PaycheckRecord,
        "name" | "depositPattern" | "color" | "paychecksPerYear" | "extraIncome"
      >
    >,
  ) => void;
  onDeletePaycheck: (id: string) => void;
  onSetValue: (versionId: string, itemId: string, amount: number) => void;
  onUpdateVersion: (
    versionId: string,
    patch: Partial<
      Pick<PaycheckVersionRecord, "effectiveFrom" | "effectiveTo" | "gross">
    >,
  ) => void;
  // A new version starts as a copy of `copyFrom`; with a transaction id it's a one-off for that
  // deposit. Returns the new version's id.
  onAddVersion: (
    paycheckId: string,
    effectiveFrom: string,
    copyFrom: string,
    transactionId?: string | null,
  ) => string;
  onDeleteVersion: (versionId: string) => void;
  onSaveBucket: (
    bucket: Pick<PaycheckBucketRecord, "id" | "name" | "color">,
  ) => void;
  onDeleteBucket: (id: string) => void;
  onSaveItem: (
    item: Pick<PaycheckItemRecord, "id" | "label" | "bucketId">,
  ) => void;
  onDeleteItem: (id: string) => void;
  onMoveItem: (
    itemId: string,
    bucketId: string | null,
    beforeItemId: string | null,
  ) => void;
  onMoveBucket: (bucketId: string, beforeBucketId: string | null) => void;
  // Whether paycheck deposits tie to the paychecks' numbers, shown beside the tools.
  check?: DepositCheck;
};

const money = (value: number) =>
  value.toLocaleString(undefined, { style: "currency", currency: "USD" });

const todayIso = () => toIsoDate(new Date().toLocaleDateString("en-US"));

const prettyDate = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

// The paychecks as one grid: a column per paycheck, a row per line item (grouped by bucket), with
// gross at the top and net and deposits pinned at the bottom. Each paycheck is versioned: its
// version buttons show how it looked over any date range, and a new version carries the numbers
// forward. A one-off version adjusts a single deposit (a commission check) without touching the
// paycheck's numbers.
//
function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// The grid is read-only. "Edit" unlocks only the numbers and dates; the structure lives elsewhere:
// "Line items" manages the shared buckets and items, and a paycheck's ⋯ opens its settings.
function PaychecksTab({
  paychecks,
  buckets,
  items,
  deposits,
  selectedPaycheckId,
  onSelectPaycheck,
  onAddPaycheck,
  onUpdatePaycheck,
  onDeletePaycheck,
  onSetValue,
  onUpdateVersion,
  onAddVersion,
  onDeleteVersion,
  onSaveBucket,
  onDeleteBucket,
  onSaveItem,
  onDeleteItem,
  onMoveItem,
  onMoveBucket,
  check,
}: PaychecksTabProps) {
  const [editRequested, setEditing] = useState(false);
  // Show each paycheck's numbers as entered, or scaled up by its paychecks per year.
  const [period, setPeriod] = useState<"paycheck" | "year">("paycheck");
  const yearly = period === "year";
  // The yearly view is read-only; the numbers are entered per paycheck.
  const editing = editRequested && !yearly;
  const [managingItems, setManagingItems] = useState(false);
  // Which version each paycheck's column is showing; unset means its current one.
  const [viewing, setViewing] = useState<Record<string, string>>({});
  // The paycheck whose "new version" date picker is open, and its date.
  const [versioning, setVersioning] = useState<{
    paycheckId: string;
    date: string;
  } | null>(null);
  const [offFor, setOffFor] = useState<string | null>(null);
  // The paycheck whose version menu is open.
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const orderedBuckets = [...buckets].sort((a, b) => a.position - b.position);
  const orderedItems = [...items].sort((a, b) => a.position - b.position);
  const ungrouped = orderedItems.filter(
    (item) =>
      !item.bucketId || !buckets.some((bucket) => bucket.id === item.bucketId),
  );
  const sections = [
    ...orderedBuckets.map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      color: bucket.color,
      items: orderedItems.filter((item) => item.bucketId === bucket.id),
    })),
    ...(ungrouped.length > 0
      ? [
          {
            id: UNGROUPED_ITEMS_BUCKET_ID,
            name: "Ungrouped",
            color: "#94a3b8",
            items: ungrouped,
          },
        ]
      : []),
  ];
  const depositsById = new Map(
    deposits.map((deposit) => [deposit.id, deposit] as const),
  );

  // Everything a column needs: the version on show, and how its deposits line up with the numbers
  // in effect on their dates.
  const columns = paychecks.map((paycheck) => {
    const current = currentVersion(paycheck);
    const shown =
      paycheck.versions.find(
        (version) => version.id === viewing[paycheck.id],
      ) ??
      current ??
      paycheck.versions[0];
    const mine = deposits.filter((deposit) => deposit.category === paycheck.id);
    const off = mine
      .map((deposit) => {
        const version = resolveVersion(paycheck, deposit);
        const net = version ? expectedNet(version, items) : 0;
        return {
          deposit,
          version,
          net,
          ok: !version || matchesExpectedNet(net, deposit.amount),
        };
      })
      .filter((entry) => !entry.ok)
      .sort((a, b) => b.deposit.date.localeCompare(a.deposit.date));
    return {
      paycheck,
      current,
      shown,
      count: mine.length,
      off,
      scale: yearly ? paycheck.paychecksPerYear : 1,
    };
  });

  const versionLabel = (version: PaycheckVersionRecord) => {
    if (version.transactionId) {
      const deposit = depositsById.get(version.transactionId);
      return `One-off · ${deposit?.date ?? "deposit"}`;
    }
    const from = version.effectiveFrom
      ? prettyDate(version.effectiveFrom)
      : "Start";
    const to = version.effectiveTo ? prettyDate(version.effectiveTo) : "Now";
    return `${from} – ${to}`;
  };

  const showVersion = (paycheckId: string, versionId: string | null) =>
    setViewing((current) => {
      const { [paycheckId]: _removed, ...rest } = current;
      return versionId ? { ...rest, [paycheckId]: versionId } : rest;
    });

  const createVersion = (paycheckId: string, copyFrom: string) => {
    if (!versioning || !versioning.date) {
      return;
    }
    showVersion(
      paycheckId,
      onAddVersion(paycheckId, versioning.date, copyFrom),
    );
    setVersioning(null);
  };

  const adjustDeposit = (
    paycheck: PaycheckRecord,
    deposit: ImportedTransaction,
    from: PaycheckVersionRecord | null,
  ) => {
    const existing = paycheck.versions.find(
      (version) => version.transactionId === deposit.id,
    );
    const id =
      existing?.id ??
      (from ? onAddVersion(paycheck.id, "", from.id, deposit.id) : null);
    if (id) {
      showVersion(paycheck.id, id);
      setPeriod("paycheck");
      setEditing(true);
    }
  };

  const colCount = columns.length + 1;
  const empty = paychecks.length === 0;

  // Clicking a paycheck's column (outside its own buttons and fields) filters the deposits to it.
  const selectColumn = (paycheckId: string, event: MouseEvent) => {
    if ((event.target as HTMLElement).closest("input, button, label")) {
      return;
    }
    onSelectPaycheck(selectedPaycheckId === paycheckId ? null : paycheckId);
  };

  const cellsFor = (render: (column: (typeof columns)[number]) => ReactNode) =>
    columns.map((column) => (
      <td
        key={column.paycheck.id}
        className={`pgrid__cell pgrid__cell--pick ${selectedPaycheckId === column.paycheck.id ? "pgrid__cell--selected" : ""}`}
        onClick={(event) => selectColumn(column.paycheck.id, event)}
      >
        {column.shown ? render(column) : null}
      </td>
    ));

  // The controls above the grid, with the paycheck check at the right.
  const toolbar = (
    <div className="pgrid__toolbar">
      {check?.status === "mismatch" && (
        <span className="income-check income-check--mismatch" role="status">
          {check.mismatched} of {check.count} deposit
          {check.count === 1 ? "" : "s"} don't match
        </span>
      )}
      <div className="pgrid__toolbar-actions">
        <div className="pgrid__period" role="group" aria-label="Amounts shown">
          {(["paycheck", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={period === value ? "pgrid__period--on" : ""}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {value === "paycheck" ? "Paycheck" : "Year"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`pgrid__edit ${editing ? "pgrid__edit--on" : ""}`}
          aria-pressed={editing}
          title="Edit amounts and dates"
          onClick={() => {
            setPeriod("paycheck");
            setEditing(!editing);
          }}
        >
          {editing ? "Done" : "Edit"}
        </button>
        <button
          type="button"
          className="pgrid__gear"
          aria-label="Open paycheck settings"
          title="Paycheck settings"
          onClick={() => setManagingItems(true)}
        >
          <GearIcon />
        </button>
      </div>
    </div>
  );

  return (
    <div className="pgrid">
      {toolbar}
      {empty ? (
        <div className="pgrid__empty">
          <p>
            Add a paycheck to enter its gross pay and what comes out of it.
            Every deposit that matches a paycheck's deposit name is filed under
            it.
          </p>
        </div>
      ) : (
        <div className="pgrid__scroll">
          <table
            className={`pgrid__table ${editing ? "pgrid__table--editing" : "pgrid__table--display"}`}
          >
            <thead>
              <tr>
                <th className="pgrid__label pgrid__corner" />
                {columns.map(({ paycheck, shown, current }) => (
                  <th
                    key={paycheck.id}
                    className={`pgrid__head ${selectedPaycheckId === paycheck.id ? "pgrid__head--selected" : ""}`}
                    style={{ borderTopColor: paycheck.color }}
                    title="Click to show this paycheck's deposits"
                    onClick={(event) => {
                      // Buttons and fields in the header do their own thing; anywhere else picks it.
                      if (
                        (event.target as HTMLElement).closest(
                          "input, button, label",
                        )
                      ) {
                        return;
                      }
                      onSelectPaycheck(
                        selectedPaycheckId === paycheck.id ? null : paycheck.id,
                      );
                    }}
                  >
                    <div className="pgrid__title">
                      <span
                        className="pgrid__swatch"
                        style={{ background: paycheck.color }}
                      />
                      <strong className="pgrid__name">{paycheck.name}</strong>
                    </div>
                    <div className="pgrid__pattern pgrid__pattern--static">
                      {paycheck.depositPattern || "No deposit name"}
                    </div>

                    <div className="pgrid__versions">
                      {(() => {
                        const options = [
                          ...[...datedVersions(paycheck)].reverse(),
                          ...paycheck.versions.filter(
                            (version) => version.transactionId !== null,
                          ),
                        ];
                        const open = menuFor === paycheck.id;
                        return (
                          <>
                            <div className="pgrid__versionbar">
                              <button
                                type="button"
                                className={`pgrid__version pgrid__version--active pgrid__version--select ${open ? "pgrid__version--open" : ""}`}
                                aria-haspopup="listbox"
                                aria-expanded={open}
                                title={
                                  options.length > 1
                                    ? "Switch version"
                                    : undefined
                                }
                                onClick={() =>
                                  setMenuFor(open ? null : paycheck.id)
                                }
                              >
                                {shown?.id === current?.id && <em>Current</em>}
                                <span>
                                  {shown ? versionLabel(shown) : "No version"}
                                </span>
                                {options.length > 1 && (
                                  <i aria-hidden="true">▾</i>
                                )}
                              </button>
                            </div>

                            {open && (
                              <>
                                <div
                                  className="pgrid__menu-backdrop"
                                  onClick={() => setMenuFor(null)}
                                />
                                <ul
                                  className="pgrid__menu"
                                  role="listbox"
                                  aria-label={`${paycheck.name} versions`}
                                >
                                  {options.map((version) => (
                                    <li
                                      key={version.id}
                                      role="option"
                                      aria-selected={shown?.id === version.id}
                                    >
                                      <button
                                        type="button"
                                        className={
                                          shown?.id === version.id
                                            ? "pgrid__menu-item--active"
                                            : ""
                                        }
                                        onClick={() => {
                                          showVersion(paycheck.id, version.id);
                                          setMenuFor(null);
                                        }}
                                      >
                                        <span>{versionLabel(version)}</span>
                                        {version.id === current?.id && (
                                          <em>Current</em>
                                        )}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}

                            {editing && shown && !shown.transactionId && (
                              <div className="pgrid__daterow">
                                <input
                                  type="date"
                                  aria-label="From"
                                  title="First day these numbers apply. Leave empty for from the start."
                                  value={shown.effectiveFrom}
                                  onChange={(event) =>
                                    onUpdateVersion(shown.id, {
                                      effectiveFrom: event.target.value,
                                    })
                                  }
                                />
                                <span aria-hidden="true">–</span>
                                <input
                                  type="date"
                                  aria-label="Until"
                                  title="Last day these numbers apply. Leave empty while they're still current."
                                  value={shown.effectiveTo}
                                  onChange={(event) =>
                                    onUpdateVersion(shown.id, {
                                      effectiveTo: event.target.value,
                                    })
                                  }
                                />
                              </div>
                            )}
                            {editing && (
                              <button
                                type="button"
                                className="pgrid__version-add"
                                title="New version from a date"
                                aria-label={`New version of ${paycheck.name}`}
                                onClick={() =>
                                  setVersioning(
                                    versioning?.paycheckId === paycheck.id
                                      ? null
                                      : {
                                          paycheckId: paycheck.id,
                                          date: todayIso(),
                                        },
                                  )
                                }
                              >
                                ＋ New version
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    {editing &&
                      versioning?.paycheckId === paycheck.id &&
                      shown && (
                        <div className="pgrid__newversion">
                          <label>
                            <span>Effective from</span>
                            <input
                              type="date"
                              value={versioning.date}
                              onChange={(event) =>
                                setVersioning({
                                  ...versioning,
                                  date: event.target.value,
                                })
                              }
                            />
                          </label>
                          <span className="pgrid__newversion-hint">
                            Starts as a copy of what's shown.
                          </span>
                          <div>
                            <button
                              type="button"
                              disabled={!versioning.date}
                              onClick={() =>
                                createVersion(paycheck.id, shown.id)
                              }
                            >
                              Create
                            </button>
                            <button
                              type="button"
                              onClick={() => setVersioning(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              <tr className="pgrid__gross">
                <th className="pgrid__label" scope="row">
                  Gross income
                </th>
                {cellsFor(({ shown, scale }) =>
                  editing ? (
                    <NumberField
                      ariaLabel="Gross income"
                      value={shown.gross}
                      onChange={() => {}}
                      onCommit={(gross) => {
                        if (gross !== shown.gross) {
                          onUpdateVersion(shown.id, { gross });
                        }
                      }}
                    />
                  ) : (
                    <span className="pgrid__value">
                      {money(shown.gross * scale)}
                    </span>
                  ),
                )}
              </tr>

              {sections.map((section) => (
                <SectionRows
                  key={section.id}
                  section={section}
                  columns={columns}
                  colCount={colCount}
                  editing={editing}
                  onSetValue={onSetValue}
                  selectedPaycheckId={selectedPaycheckId}
                  onSelectColumn={selectColumn}
                />
              ))}

              <tr className="pgrid__net pgrid__pin pgrid__pin--net">
                <th className="pgrid__label" scope="row">
                  Net pay
                </th>
                {cellsFor(({ shown, scale }) => (
                  <span className="pgrid__value">
                    {money(expectedNet(shown, items) * scale)}
                  </span>
                ))}
              </tr>
              <tr className="pgrid__pin pgrid__pin--deposits">
                <th className="pgrid__label" scope="row">
                  Deposits
                </th>
                {cellsFor(({ paycheck, count, off }) => {
                  const selected = selectedPaycheckId === paycheck.id;
                  return (
                    <div className="pgrid__deposits">
                      <button
                        type="button"
                        className={`pgrid__deposit-btn ${selected ? "pgrid__deposit-btn--selected" : ""}`}
                        disabled={count === 0}
                        title={
                          selected
                            ? "Showing these deposits. Click to show all."
                            : "Show this paycheck's deposits"
                        }
                        onClick={() =>
                          onSelectPaycheck(selected ? null : paycheck.id)
                        }
                      >
                        <strong>{count}</strong> deposit{count === 1 ? "" : "s"}
                        {count > 0 && off.length === 0 && (
                          <span className="pgrid__ok">✓</span>
                        )}
                      </button>
                      {off.length > 0 && (
                        <button
                          type="button"
                          className="pgrid__off"
                          title="Show these deposits and which ones are off"
                          onClick={() => {
                            onSelectPaycheck(paycheck.id);
                            setOffFor(
                              offFor === paycheck.id && selected
                                ? null
                                : paycheck.id,
                            );
                          }}
                        >
                          {off.length} of {count} off
                        </button>
                      )}
                    </div>
                  );
                })}
              </tr>
              {editing && (
                <tr className="pgrid__removerow pgrid__pin pgrid__pin--remove">
                  <th className="pgrid__label" scope="row" />
                  {cellsFor(({ paycheck, shown }) => {
                    const lastDated =
                      !shown.transactionId &&
                      datedVersions(paycheck).length <= 1;
                    return (
                      <button
                        type="button"
                        className="pgrid__version-delete"
                        title={
                          lastDated
                            ? "A paycheck needs at least one version"
                            : undefined
                        }
                        disabled={lastDated}
                        onClick={() => {
                          onDeleteVersion(shown.id);
                          showVersion(paycheck.id, null);
                        }}
                      >
                        {shown.transactionId
                          ? "Remove one-off"
                          : "Delete version"}
                      </button>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {offFor &&
        (() => {
          const column = columns.find(
            (candidate) => candidate.paycheck.id === offFor,
          );
          if (!column || column.off.length === 0) {
            return null;
          }
          return (
            <section className="pgrid__offlist">
              <button
                type="button"
                className="pgrid__close"
                aria-label="Close"
                onClick={() => setOffFor(null)}
              >
                ×
              </button>
              <h3>{column.paycheck.name}: deposits that don't match</h3>
              <p>
                A deposit that differs from its paycheck's net (a commission
                check, say) can get its own numbers without changing the
                paycheck.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Deposit</th>
                    <th>Expected</th>
                    <th>Off by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {column.off.map(({ deposit, version, net }) => (
                    <tr key={deposit.id}>
                      <td>{deposit.date}</td>
                      <td>{money(deposit.amount)}</td>
                      <td>{money(net)}</td>
                      <td>{money(deposit.amount - net)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() =>
                            adjustDeposit(column.paycheck, deposit, version)
                          }
                        >
                          {version?.transactionId
                            ? "Edit one-off"
                            : "Adjust this deposit"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })()}

      {managingItems && (
        <LineItemsManager
          paychecks={paychecks}
          onAddPaycheck={(name) => {
            onAddPaycheck(name);
            setEditing(true);
          }}
          onUpdatePaycheck={onUpdatePaycheck}
          onDeletePaycheck={onDeletePaycheck}
          buckets={buckets}
          items={items}
          onClose={() => setManagingItems(false)}
          onSaveBucket={onSaveBucket}
          onDeleteBucket={onDeleteBucket}
          onSaveItem={onSaveItem}
          onDeleteItem={onDeleteItem}
          onMoveItem={onMoveItem}
          onMoveBucket={onMoveBucket}
        />
      )}
    </div>
  );
}

type Column = {
  paycheck: PaycheckRecord;
  shown: PaycheckVersionRecord;
  // What the amounts are multiplied by: 1 per paycheck, its paychecks per year for a year.
  scale: number;
};

type SectionProps = {
  section: {
    id: string;
    name: string;
    color: string;
    items: PaycheckItemRecord[];
  };
  columns: Column[];
  colCount: number;
  editing: boolean;
  onSetValue: PaychecksTabProps["onSetValue"];
  selectedPaycheckId: string | null;
  onSelectColumn: (paycheckId: string, event: MouseEvent) => void;
};

// One bucket: a header row, a row per line item with a cell per paycheck, and a subtotal.
function SectionRows({
  section,
  columns,
  colCount,
  editing,
  onSetValue,
  selectedPaycheckId,
  onSelectColumn,
}: SectionProps) {
  const tint = { "--bucket": softenColor(section.color) } as CSSProperties;
  return (
    <>
      <tr className="pgrid__gap" aria-hidden="true">
        <td colSpan={colCount} />
      </tr>

      {section.items.map((item) => (
        <tr key={item.id} className="pgrid__item" style={tint}>
          <th className="pgrid__label" scope="row">
            {item.label}
          </th>
          {columns.map(({ paycheck, shown, scale }) => (
            <td
              key={paycheck.id}
              className={`pgrid__cell pgrid__cell--pick ${selectedPaycheckId === paycheck.id ? "pgrid__cell--selected" : ""}`}
              onClick={(event) => onSelectColumn(paycheck.id, event)}
            >
              {editing ? (
                <NumberField
                  ariaLabel={`${item.label} amount for ${paycheck.name}`}
                  value={paycheckItemAmount(shown, item.id)}
                  onChange={() => {}}
                  onCommit={(amount) => {
                    if (amount !== paycheckItemAmount(shown, item.id)) {
                      onSetValue(shown.id, item.id, amount);
                    }
                  }}
                />
              ) : (
                <span className="pgrid__value">
                  {paycheckItemAmount(shown, item.id) === 0
                    ? "—"
                    : money(paycheckItemAmount(shown, item.id) * scale)}
                </span>
              )}
            </td>
          ))}
        </tr>
      ))}

      {section.items.length === 0 && (
        <tr className="pgrid__item" style={tint}>
          <td colSpan={colCount} className="pgrid__muted pgrid__none">
            No line items
          </td>
        </tr>
      )}

      <tr className="pgrid__subtotal" style={tint}>
        <th className="pgrid__label" scope="row">
          {section.name}
        </th>
        {columns.map(({ paycheck, shown, scale }) => (
          <td
              key={paycheck.id}
              className={`pgrid__cell pgrid__cell--pick ${selectedPaycheckId === paycheck.id ? "pgrid__cell--selected" : ""}`}
              onClick={(event) => onSelectColumn(paycheck.id, event)}
            >
            <span className="pgrid__value">
              {money(
                paycheckSubtotal(
                  shown,
                  section.items.map((item) => item.id),
                ) * scale,
              )}
            </span>
          </td>
        ))}
      </tr>
    </>
  );
}

export default PaychecksTab;
