import { useState, type ReactNode } from "react";
import NumberField from "../taxes/NumberField";
import { BUCKET_COLOR_PALETTE } from "../spending/lib/categories";
import type { ImportedTransaction } from "../spending/lib/csvParser";
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
    patch: Partial<Pick<PaycheckRecord, "name" | "depositPattern" | "color">>,
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
  // Drag and drop: move an item into a bucket (null = ungrouped) before another item (null = end),
  // or move a bucket before another bucket (null = end).
  onMoveItem: (
    itemId: string,
    bucketId: string | null,
    beforeItemId: string | null,
  ) => void;
  onMoveBucket: (bucketId: string, beforeBucketId: string | null) => void;
};

type Drag = { kind: "item" | "bucket"; id: string };

// A grip that drags the whole row it sits in (inputs inside can't start a drag themselves).
function gripProps(drag: Drag, setDrag: (drag: Drag | null) => void) {
  return {
    draggable: true,
    onDragStart: (event: React.DragEvent<HTMLElement>) => {
      const row = event.currentTarget.closest("tr");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", drag.id);
      if (row) {
        event.dataTransfer.setDragImage(row, 0, 0);
      }
      setDrag(drag);
    },
    onDragEnd: () => setDrag(null),
  };
}

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
// gross at the top and net at the bottom. Each paycheck is versioned: the picker in its header
// shows how it looked from any date, and a new version carries the numbers forward. A one-off
// version adjusts a single deposit (a commission check) without touching the paycheck's numbers.
// "Edit line items" turns the rows into editors; the line items are shared by every paycheck.
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
}: PaychecksTabProps) {
  const [newName, setNewName] = useState("");
  const [editingItems, setEditingItems] = useState(false);
  const [newBucket, setNewBucket] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [newItemByBucket, setNewItemByBucket] = useState<
    Record<string, string>
  >({});
  // Which version each paycheck's column is showing; unset means its current one.
  const [viewing, setViewing] = useState<Record<string, string>>({});
  // The paycheck whose "new version" date picker is open, and its date.
  const [versioning, setVersioning] = useState<{
    paycheckId: string;
    date: string;
  } | null>(null);
  const [offFor, setOffFor] = useState<string | null>(null);
  // The paycheck waiting on a second click before it (and all its versions) is deleted.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const orderedBuckets = [...buckets].sort((a, b) => a.position - b.position);
  const orderedItems = [...items].sort((a, b) => a.position - b.position);
  const ungrouped = orderedItems.filter(
    (item) => !item.bucketId || !buckets.some((b) => b.id === item.bucketId),
  );
  const sections = [
    ...orderedBuckets.map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      color: bucket.color,
      items: orderedItems.filter((item) => item.bucketId === bucket.id),
      bucket,
    })),
    ...(ungrouped.length > 0 || editingItems
      ? [
          {
            id: UNGROUPED_ITEMS_BUCKET_ID,
            name: "Ungrouped",
            color: "#94a3b8",
            items: ungrouped,
            bucket: null,
          },
        ]
      : []),
  ];
  const depositsById = new Map(
    deposits.map((deposit) => [deposit.id, deposit] as const),
  );

  // Everything a column needs: the version on show, whether it can be edited, and how its
  // deposits line up with the numbers in effect on their dates.
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
    return { paycheck, current, shown, count: mine.length, off };
  });

  const versionLabel = (
    _paycheck: PaycheckRecord,
    version: PaycheckVersionRecord,
  ) => {
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

  const addPaycheck = () => {
    const name = newName.trim();
    if (name) {
      onAddPaycheck(name);
      setNewName("");
    }
  };

  const createVersion = (paycheckId: string, copyFrom: string) => {
    if (!versioning || !versioning.date) {
      return;
    }
    const id = onAddVersion(paycheckId, versioning.date, copyFrom);
    setViewing((current) => ({ ...current, [paycheckId]: id }));
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
      setViewing((current) => ({ ...current, [paycheck.id]: id }));
    }
  };

  const colCount = columns.length + 1;
  const empty = paychecks.length === 0;

  const cellsFor = (
    render: (column: (typeof columns)[number]) => ReactNode,
    className = "",
  ) =>
    columns.map((column) => (
      <td key={column.paycheck.id} className={`pgrid__cell ${className}`}>
        {column.shown ? render(column) : null}
      </td>
    ));

  return (
    <div className="pgrid">
      {(editingItems || empty) && (
        <div className="pgrid__bar">
          <form
            className="pgrid__add"
            onSubmit={(event) => {
              event.preventDefault();
              addPaycheck();
            }}
          >
            <input
              placeholder="New paycheck, e.g. Rachel Salary"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" disabled={!newName.trim()}>
              Add paycheck
            </button>
          </form>
          {empty && !editingItems && (
            <button type="button" onClick={() => setEditingItems(true)}>
              Edit
            </button>
          )}
        </div>
      )}

      {empty ? (
        <div className="pgrid__empty">
          Add a paycheck to enter its gross pay and what comes out of it. Every
          deposit that matches a paycheck's deposit name is filed under it.
        </div>
      ) : (
        <div className="pgrid__scroll">
          <table
            className={`pgrid__table ${editingItems ? "pgrid__table--editing" : ""}`}
          >
            <thead>
              <tr>
                <th className="pgrid__label pgrid__corner">
                  <button
                    type="button"
                    className={`pgrid__edit ${editingItems ? "pgrid__edit--on" : ""}`}
                    aria-pressed={editingItems}
                    onClick={() => setEditingItems((current) => !current)}
                  >
                    {editingItems ? "Done" : "Edit"}
                  </button>
                </th>
                {columns.map(({ paycheck, shown, current }) => (
                  <th
                    key={paycheck.id}
                    className={`pgrid__head ${selectedPaycheckId === paycheck.id ? "pgrid__head--selected" : ""}`}
                    style={{ borderTopColor: paycheck.color }}
                    title="Click to show this paycheck's deposits"
                    onClick={(event) => {
                      // Clicks on the header's own fields edit them; anywhere else picks the paycheck.
                      if (
                        (event.target as HTMLElement).closest(
                          "input, select, button, label",
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
                      {editingItems ? (
                        <>
                          <input
                            type="color"
                            aria-label={`${paycheck.name} color`}
                            value={paycheck.color}
                            onChange={(event) =>
                              onUpdatePaycheck(paycheck.id, {
                                color: event.target.value,
                              })
                            }
                          />
                          <input
                            key={paycheck.name}
                            aria-label="Paycheck name"
                            defaultValue={paycheck.name}
                            onBlur={(event) => {
                              const name = event.target.value.trim();
                              if (name && name !== paycheck.name) {
                                onUpdatePaycheck(paycheck.id, { name });
                              } else {
                                event.target.value = paycheck.name;
                              }
                            }}
                          />
                        </>
                      ) : (
                        <>
                          <span
                            className="pgrid__swatch"
                            style={{ background: paycheck.color }}
                          />
                          <strong className="pgrid__name">
                            {paycheck.name}
                          </strong>
                        </>
                      )}
                    </div>
                    {editingItems ? (
                      <input
                        className="pgrid__pattern"
                        aria-label="Deposit name contains"
                        placeholder="Deposit name contains…"
                        defaultValue={paycheck.depositPattern}
                        onBlur={(event) => {
                          const depositPattern = event.target.value.trim();
                          if (depositPattern !== paycheck.depositPattern) {
                            onUpdatePaycheck(paycheck.id, { depositPattern });
                          }
                        }}
                      />
                    ) : (
                      <div className="pgrid__pattern pgrid__pattern--static">
                        {paycheck.depositPattern || "No deposit name"}
                      </div>
                    )}
                    <div
                      className="pgrid__versions"
                      role="group"
                      aria-label={`${paycheck.name} versions`}
                    >
                      {[
                        ...[...datedVersions(paycheck)].reverse(),
                        ...paycheck.versions.filter(
                          (version) => version.transactionId !== null,
                        ),
                      ].map((version) =>
                        shown?.id === version.id &&
                        editingItems &&
                        !version.transactionId ? (
                          <div
                            key={version.id}
                            className="pgrid__version pgrid__version--active pgrid__version--editing"
                          >
                            <input
                              type="date"
                              aria-label="From"
                              title="First day these numbers apply. Leave empty for from the start."
                              value={version.effectiveFrom}
                              onChange={(event) =>
                                onUpdateVersion(version.id, {
                                  effectiveFrom: event.target.value,
                                })
                              }
                            />
                            <span aria-hidden="true">–</span>
                            <input
                              type="date"
                              aria-label="Until"
                              title="Last day these numbers apply. Leave empty while they're still current."
                              value={version.effectiveTo}
                              onChange={(event) =>
                                onUpdateVersion(version.id, {
                                  effectiveTo: event.target.value,
                                })
                              }
                            />
                          </div>
                        ) : (
                          <button
                            key={version.id}
                            type="button"
                            aria-pressed={shown?.id === version.id}
                            className={`pgrid__version ${shown?.id === version.id ? "pgrid__version--active" : ""}`}
                            onClick={() =>
                              setViewing((all) => ({
                                ...all,
                                [paycheck.id]: version.id,
                              }))
                            }
                          >
                            <span>{versionLabel(paycheck, version)}</span>
                            {version.id === current?.id && <em>Current</em>}
                          </button>
                        ),
                      )}
                      {editingItems && (
                        <button
                          type="button"
                          className="pgrid__version-add"
                          title="New version from a date"
                          aria-label={`New version of ${paycheck.name}`}
                          onClick={() =>
                            setVersioning(
                              versioning?.paycheckId === paycheck.id
                                ? null
                                : { paycheckId: paycheck.id, date: todayIso() },
                            )
                          }
                        >
                          ＋ New version
                        </button>
                      )}
                    </div>
                    {editingItems &&
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
                {cellsFor(({ shown }) =>
                  editingItems ? (
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
                    <span className="pgrid__value">{money(shown.gross)}</span>
                  ),
                )}
              </tr>

              {sections.map((section) => (
                <SectionRows
                  key={section.id}
                  section={section}
                  columns={columns}
                  colCount={colCount}
                  editingItems={editingItems}
                  drag={drag}
                  setDrag={setDrag}
                  dropTarget={dropTarget}
                  setDropTarget={setDropTarget}
                  newItem={newItemByBucket[section.id] ?? ""}
                  setNewItem={(value) =>
                    setNewItemByBucket((current) => ({
                      ...current,
                      [section.id]: value,
                    }))
                  }
                  onSetValue={onSetValue}
                  onSaveBucket={onSaveBucket}
                  onDeleteBucket={onDeleteBucket}
                  onSaveItem={onSaveItem}
                  onDeleteItem={onDeleteItem}
                  onMoveItem={onMoveItem}
                  onMoveBucket={onMoveBucket}
                />
              ))}

              <tr className="pgrid__net pgrid__pin pgrid__pin--net">
                <th className="pgrid__label" scope="row">
                  Net pay
                </th>
                {cellsFor(({ shown }) => (
                  <span className="pgrid__value">
                    {money(expectedNet(shown, items))}
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
              {editingItems && (
                <tr className="pgrid__pin pgrid__pin--actions">
                  <td />
                  {columns.map(({ paycheck, shown }) => {
                    // The only dated version can't go: a paycheck always has numbers to fall back on.
                    const lastDated =
                      shown.transactionId === null &&
                      datedVersions(paycheck).length <= 1;
                    const confirming = confirmingDelete === paycheck.id;
                    return (
                      <td key={paycheck.id} className="pgrid__cell">
                        <div className="pgrid__actions">
                          {confirming ? (
                            <>
                              <span>Delete {paycheck.name}?</span>
                              <button
                                type="button"
                                className="pgrid__danger"
                                onClick={() => {
                                  setConfirmingDelete(null);
                                  onDeletePaycheck(paycheck.id);
                                }}
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                className="pgrid__link"
                                onClick={() => setConfirmingDelete(null)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="pgrid__link"
                                disabled={lastDated}
                                title={
                                  lastDated
                                    ? "This is the paycheck's only version. Add another first, or delete the whole paycheck."
                                    : undefined
                                }
                                onClick={() => {
                                  onDeleteVersion(shown.id);
                                  setViewing(
                                    ({ [paycheck.id]: _removed, ...rest }) =>
                                      rest,
                                  );
                                }}
                              >
                                {shown.transactionId
                                  ? "Remove one-off"
                                  : "Delete version"}
                              </button>
                              <button
                                type="button"
                                className="pgrid__link"
                                onClick={() => setConfirmingDelete(paycheck.id)}
                              >
                                Delete paycheck…
                              </button>
                            </>
                          )}
                        </div>
                      </td>
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
                          onClick={() => {
                            setEditingItems(true);
                            adjustDeposit(column.paycheck, deposit, version);
                          }}
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

      {editingItems && (
        <form
          className="pgrid__add"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newBucket.trim();
            if (name) {
              onSaveBucket({
                id: crypto.randomUUID(),
                name,
                color:
                  BUCKET_COLOR_PALETTE[
                    buckets.length % BUCKET_COLOR_PALETTE.length
                  ],
              });
              setNewBucket("");
            }
          }}
        >
          <input
            placeholder="New bucket"
            value={newBucket}
            onChange={(event) => setNewBucket(event.target.value)}
          />
          <button type="submit" disabled={!newBucket.trim()}>
            Add bucket
          </button>
        </form>
      )}
    </div>
  );
}

type Column = {
  paycheck: PaycheckRecord;
  shown: PaycheckVersionRecord;
};

type SectionProps = {
  section: {
    id: string;
    name: string;
    color: string;
    items: PaycheckItemRecord[];
    bucket: PaycheckBucketRecord | null;
  };
  columns: Column[];
  colCount: number;
  editingItems: boolean;
  drag: Drag | null;
  setDrag: (drag: Drag | null) => void;
  dropTarget: string | null;
  setDropTarget: (target: string | null) => void;
  newItem: string;
  setNewItem: (value: string) => void;
  onSetValue: PaychecksTabProps["onSetValue"];
  onSaveBucket: PaychecksTabProps["onSaveBucket"];
  onDeleteBucket: PaychecksTabProps["onDeleteBucket"];
  onSaveItem: PaychecksTabProps["onSaveItem"];
  onDeleteItem: PaychecksTabProps["onDeleteItem"];
  onMoveItem: PaychecksTabProps["onMoveItem"];
  onMoveBucket: PaychecksTabProps["onMoveBucket"];
};

// One bucket: a header row, a row per line item with a cell per paycheck, and a subtotal.
function SectionRows({
  section,
  columns,
  colCount,
  editingItems,
  drag,
  setDrag,
  dropTarget,
  setDropTarget,
  newItem,
  setNewItem,
  onSetValue,
  onSaveBucket,
  onDeleteBucket,
  onSaveItem,
  onDeleteItem,
  onMoveItem,
  onMoveBucket,
}: SectionProps) {
  const bucketId = section.bucket?.id ?? null;
  const headerTarget = `bucket:${section.id}`;

  return (
    <>
      <tr
        className={`pgrid__bucket ${dropTarget === headerTarget ? "pgrid__drop" : ""}`}
        style={{ borderTopColor: section.color }}
        onDragOver={
          editingItems && drag
            ? (event) => {
                event.preventDefault();
                setDropTarget(headerTarget);
              }
            : undefined
        }
        onDrop={
          editingItems && drag
            ? (event) => {
                event.preventDefault();
                if (drag.kind === "item") {
                  onMoveItem(drag.id, bucketId, null);
                } else {
                  onMoveBucket(drag.id, bucketId);
                }
                setDrag(null);
                setDropTarget(null);
              }
            : undefined
        }
      >
        <th colSpan={colCount} scope="colgroup">
          {editingItems && section.bucket ? (
            <div className="pgrid__editrow">
              <input
                type="color"
                aria-label={`${section.name} color`}
                value={section.color}
                onChange={(event) =>
                  onSaveBucket({
                    id: section.bucket!.id,
                    name: section.name,
                    color: event.target.value,
                  })
                }
              />
              <span
                className="pgrid__grip"
                title="Drag to reorder"
                {...gripProps(
                  { kind: "bucket", id: section.bucket.id },
                  setDrag,
                )}
              >
                ⋮⋮
              </span>
              <input
                aria-label="Bucket name"
                defaultValue={section.name}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (name && name !== section.name) {
                    onSaveBucket({
                      id: section.bucket!.id,
                      name,
                      color: section.color,
                    });
                  } else {
                    event.target.value = section.name;
                  }
                }}
              />
              <button
                type="button"
                className="pgrid__delete"
                aria-label={`Delete ${section.name}`}
                onClick={() => onDeleteBucket(section.bucket!.id)}
              >
                ✕
              </button>
            </div>
          ) : (
            <span className="pgrid__bucket-name">{section.name}</span>
          )}
        </th>
      </tr>

      {section.items.map((item) => (
        <tr
          key={item.id}
          className={
            dropTarget === `item:${item.id}` ? "pgrid__drop-before" : ""
          }
          onDragOver={
            editingItems && drag?.kind === "item"
              ? (event) => {
                  event.preventDefault();
                  setDropTarget(`item:${item.id}`);
                }
              : undefined
          }
          onDrop={
            editingItems && drag?.kind === "item"
              ? (event) => {
                  event.preventDefault();
                  onMoveItem(drag.id, bucketId, item.id);
                  setDrag(null);
                  setDropTarget(null);
                }
              : undefined
          }
        >
          <th className="pgrid__label" scope="row">
            {editingItems ? (
              <div className="pgrid__editrow">
                <span
                  className="pgrid__grip"
                  title="Drag to move"
                  {...gripProps({ kind: "item", id: item.id }, setDrag)}
                >
                  ⋮⋮
                </span>
                <input
                  aria-label="Line item name"
                  defaultValue={item.label}
                  onBlur={(event) => {
                    const label = event.target.value.trim();
                    if (label && label !== item.label) {
                      onSaveItem({
                        id: item.id,
                        label,
                        bucketId: item.bucketId,
                      });
                    } else {
                      event.target.value = item.label;
                    }
                  }}
                />
                <button
                  type="button"
                  className="pgrid__delete"
                  aria-label={`Delete ${item.label}`}
                  onClick={() => onDeleteItem(item.id)}
                >
                  ✕
                </button>
              </div>
            ) : (
              item.label
            )}
          </th>
          {columns.map(({ paycheck, shown }) => (
            <td key={paycheck.id} className="pgrid__cell">
              {editingItems ? (
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
                    : money(paycheckItemAmount(shown, item.id))}
                </span>
              )}
            </td>
          ))}
        </tr>
      ))}

      {section.items.length === 0 && (
        <tr>
          <td colSpan={colCount} className="pgrid__muted pgrid__none">
            No line items
          </td>
        </tr>
      )}

      {editingItems && section.bucket && (
        <tr>
          <td colSpan={colCount}>
            <form
              className="pgrid__add pgrid__add--inline"
              onSubmit={(event) => {
                event.preventDefault();
                const label = newItem.trim();
                if (label) {
                  onSaveItem({
                    id: crypto.randomUUID(),
                    label,
                    bucketId: section.bucket!.id,
                  });
                  setNewItem("");
                }
              }}
            >
              <input
                placeholder="New line item"
                value={newItem}
                onChange={(event) => setNewItem(event.target.value)}
              />
              <button type="submit" disabled={!newItem.trim()}>
                Add
              </button>
            </form>
          </td>
        </tr>
      )}

      <tr className="pgrid__subtotal">
        <th className="pgrid__label" scope="row">
          {section.name} subtotal
        </th>
        {columns.map(({ paycheck, shown }) => (
          <td key={paycheck.id} className="pgrid__cell">
            <span className="pgrid__value">
              {money(
                paycheckSubtotal(
                  shown,
                  section.items.map((item) => item.id),
                ),
              )}
            </span>
          </td>
        ))}
      </tr>
    </>
  );
}

export default PaychecksTab;
