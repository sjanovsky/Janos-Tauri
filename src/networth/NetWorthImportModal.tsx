import { useMemo, useState } from "react";
import {
  nextBucketColor,
  UNGROUPED_BUCKET_COLOR,
  UNGROUPED_BUCKET_ID,
  type AccountRecord,
  type BalanceRecord,
  type NetWorthBucketRecord,
} from "./lib/networth";
import { parseNetWorthPaste, type ParsedImport } from "./lib/importParse";

export type ImportPayload = {
  buckets: NetWorthBucketRecord[];
  accounts: AccountRecord[];
  balances: BalanceRecord[];
};

type NetWorthImportModalProps = {
  buckets: NetWorthBucketRecord[];
  accounts: AccountRecord[];
  // Persist a resolved import; resolves to null on success, or the backend's error string. The
  // parent closes the modal on success (and the surrounding Modal handles ✕ / backdrop / Escape).
  onImport: (payload: ImportPayload) => Promise<string | null>;
};

// The dropdown value for "don't map to an existing account — create a new one from this row". A real
// account's id is any other value.
const NEW_ACCOUNT = "__new__";

// Per-row editable state in the preview, parallel to `parsed.accounts`. `target` is the existing
// account the pasted row maps onto, or NEW_ACCOUNT to create one.
type RowDraft = { target: string; include: boolean };

// A valid grid month is "YYYY-MM" with a month of 01..12.
function isValidMonth(value: string): boolean {
  const match = value.trim().match(/^(\d{4})-(\d{2})$/);
  return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

const SKIP_REASON_LABEL: Record<ParsedImport["skipped"][number]["reason"], string> = {
  subtotal: "subtotal",
  total: "total",
  empty: "no data",
};

// Best guess for which existing account a pasted row label belongs to: an exact (case-insensitive)
// name match, else the sole account whose name contains (or is contained by) the label — so
// "Stephen" maps onto "Stephen 401K". Ambiguous or no match → create a new account.
function guessTarget(label: string, accounts: AccountRecord[]): string {
  const normalized = label.trim().toLowerCase();
  if (!normalized) {
    return NEW_ACCOUNT;
  }
  const exact = accounts.find((account) => account.name.trim().toLowerCase() === normalized);
  if (exact) {
    return exact.id;
  }
  if (normalized.length >= 3) {
    const contained = accounts.filter((account) => {
      const name = account.name.trim().toLowerCase();
      return name.includes(normalized) || normalized.includes(name);
    });
    if (contained.length === 1) {
      return contained[0].id;
    }
  }
  return NEW_ACCOUNT;
}

// The paste-import flow for the Net Worth page. The user copies the block from their spreadsheet
// (the row of month headers plus the account rows) and pastes it here; the parser lays it out the
// same way the grid does, and this modal lets the user map each pasted row onto one of their
// accounts (or create a new one), confirm the months, and commit it all in one batch.
function NetWorthImportModal({ buckets, accounts, onImport }: NetWorthImportModalProps) {
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [monthDrafts, setMonthDrafts] = useState<string[]>([]);
  const [rowDrafts, setRowDrafts] = useState<RowDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const bucketColorById = useMemo(() => new Map(buckets.map((bucket) => [bucket.id, bucket.color])), [buckets]);

  // Existing accounts for the dropdown, grouped under their bucket (buckets in saved order, then an
  // Ungrouped tray), mirroring the bucket-grouped Category dropdown in the transactions list.
  const accountGroups = useMemo(() => {
    const realBucketIds = new Set(buckets.map((bucket) => bucket.id));
    const byBucket = new Map<string, AccountRecord[]>();
    accounts.forEach((account) => {
      const key = account.bucketId && realBucketIds.has(account.bucketId) ? account.bucketId : UNGROUPED_BUCKET_ID;
      const list = byBucket.get(key) ?? [];
      list.push(account);
      byBucket.set(key, list);
    });
    const sortByPosition = (a: AccountRecord, b: AccountRecord) => a.position - b.position || a.name.localeCompare(b.name);

    const groups: { label: string; accounts: AccountRecord[] }[] = [];
    [...buckets]
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .forEach((bucket) => {
        const members = byBucket.get(bucket.id);
        if (members && members.length > 0) {
          groups.push({ label: bucket.name, accounts: members.slice().sort(sortByPosition) });
        }
      });
    const ungrouped = byBucket.get(UNGROUPED_BUCKET_ID);
    if (ungrouped && ungrouped.length > 0) {
      groups.push({ label: "Ungrouped", accounts: ungrouped.slice().sort(sortByPosition) });
    }
    return groups;
  }, [buckets, accounts]);

  // Color each not-yet-created bucket (e.g. "401k" from a subtotal row) the palette color it would
  // get on import, so a "create new" pill reads like it will in the grid.
  const detectedBucketColorByName = useMemo(() => {
    const colors = new Map<string, string>();
    buckets.forEach((bucket) => colors.set(bucket.name.toLowerCase(), bucket.color));
    let newIndex = 0;
    (parsed?.accounts ?? []).forEach((account) => {
      const key = account.bucket?.toLowerCase();
      if (key && !colors.has(key)) {
        colors.set(key, nextBucketColor(buckets.length + newIndex));
        newIndex += 1;
      }
    });
    return colors;
  }, [parsed, buckets]);

  // The pill color for a row: the mapped account's bucket color, or (for a new account) the color of
  // its detected bucket. Falls back to the muted Ungrouped color.
  const colorForRow = (target: string, detectedBucket: string | null): string => {
    if (target !== NEW_ACCOUNT) {
      const account = accountById.get(target);
      const color = account?.bucketId ? bucketColorById.get(account.bucketId) : undefined;
      return color ?? UNGROUPED_BUCKET_COLOR;
    }
    const key = detectedBucket?.toLowerCase();
    return (key && detectedBucketColorByName.get(key)) || UNGROUPED_BUCKET_COLOR;
  };

  // The text shown in a row's pill: the mapped account's name, or "New account" when creating one.
  const labelForTarget = (target: string): string =>
    target === NEW_ACCOUNT ? "New account" : accountById.get(target)?.name ?? "New account";

  const handlePreview = () => {
    const result = parseNetWorthPaste(raw);
    if (result.months.length === 0) {
      setError("Couldn't find a row of months. Include the header row (the one with Dec-22, Jan-23, …) in your paste.");
      return;
    }
    if (result.accounts.length === 0) {
      setError("Found the months but no account rows beneath them. Include your account rows in the paste.");
      return;
    }
    setParsed(result);
    setMonthDrafts(result.months.map((month) => month.month ?? ""));
    setRowDrafts(
      result.accounts.map((account) => ({ target: guessTarget(account.label, accounts), include: true })),
    );
    setError(null);
  };

  const resetAll = () => {
    setParsed(null);
    setMonthDrafts([]);
    setRowDrafts([]);
    setError(null);
  };

  // The import total shown on the button and used to guard the action.
  const summary = useMemo(() => {
    if (!parsed) {
      return { accounts: 0, months: 0, balances: 0 };
    }
    const validMonths = monthDrafts.filter(isValidMonth);
    let balances = 0;
    let includedAccounts = 0;
    parsed.accounts.forEach((account, index) => {
      if (!rowDrafts[index]?.include) {
        return;
      }
      includedAccounts += 1;
      account.amounts.forEach((amount, column) => {
        if (amount !== null && isValidMonth(monthDrafts[column] ?? "")) {
          balances += 1;
        }
      });
    });
    return { accounts: includedAccounts, months: new Set(validMonths).size, balances };
  }, [parsed, monthDrafts, rowDrafts]);

  const buildPayload = (): ImportPayload => {
    const existingBucketByName = new Map(buckets.map((bucket) => [bucket.name.toLowerCase(), bucket]));

    // Resolve a detected bucket name to an id, minting a new bucket (palette color, position after
    // the last) only for a name that doesn't already exist. Used to place newly-created accounts.
    const newBuckets: NetWorthBucketRecord[] = [];
    const bucketIdByName = new Map<string, string>();
    let nextBucketPosition = buckets.reduce((max, bucket) => Math.max(max, bucket.position), -1) + 1;

    const resolveBucketId = (name: string | null): string | null => {
      const key = name?.trim().toLowerCase();
      if (!key) {
        return null;
      }
      if (bucketIdByName.has(key)) {
        return bucketIdByName.get(key)!;
      }
      const existing = existingBucketByName.get(key);
      if (existing) {
        bucketIdByName.set(key, existing.id);
        return existing.id;
      }
      const record: NetWorthBucketRecord = {
        id: crypto.randomUUID(),
        name: name!.trim(),
        color: nextBucketColor(buckets.length + newBuckets.length),
        position: nextBucketPosition,
      };
      nextBucketPosition += 1;
      newBuckets.push(record);
      bucketIdByName.set(key, record.id);
      return record.id;
    };

    const accountRecords: AccountRecord[] = [];
    const balances: BalanceRecord[] = [];
    let nextAccountPosition = accounts.reduce((max, account) => Math.max(max, account.position), -1) + 1;

    parsed!.accounts.forEach((account, index) => {
      const draft = rowDrafts[index];
      if (!draft?.include) {
        return;
      }
      let accountId: string;
      if (draft.target === NEW_ACCOUNT) {
        // Create a new account named by the pasted row, placed in its detected bucket.
        const name = account.label.trim();
        if (!name) {
          return;
        }
        accountId = crypto.randomUUID();
        accountRecords.push({
          id: accountId,
          name,
          bucketId: resolveBucketId(account.bucket),
          position: nextAccountPosition,
        });
        nextAccountPosition += 1;
      } else {
        // Map onto an existing account — just add its balances, leave the account row untouched.
        accountId = draft.target;
      }

      account.amounts.forEach((amount, column) => {
        const month = monthDrafts[column];
        if (amount !== null && isValidMonth(month ?? "")) {
          balances.push({ accountId, month: month.trim(), amount });
        }
      });
    });

    return { buckets: newBuckets, accounts: accountRecords, balances };
  };

  const handleImport = async () => {
    if (!parsed || summary.balances === 0) {
      setError("Nothing to import yet — check that at least one account is included and its months are valid.");
      return;
    }
    setIsImporting(true);
    setError(null);
    try {
      const failure = await onImport(buildPayload());
      if (failure) {
        setError(`Import failed: ${failure}`);
      }
    } finally {
      setIsImporting(false);
    }
  };

  const updateRow = (index: number, patch: Partial<RowDraft>) => {
    setRowDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="networth-import">
      {!parsed ? (
        <>
          <p className="networth-import__intro">
            In your spreadsheet, select the block that includes the <strong>month header row</strong> (Dec-22, Jan-23, …)
            and your <strong>account rows</strong>, copy it, and paste below. Subtotal rows (401k, Brokerage, Cash) and
            the Net Worth total are detected and set aside automatically.
          </p>
          <textarea
            className="networth-import__textarea"
            placeholder="Paste your copied spreadsheet rows here…"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            rows={10}
          />
          <div className="networth-import__actions">
            <button type="button" className="networth-import__button networth-import__button--primary" onClick={handlePreview}>
              Preview
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="networth-import__intro">
            Map each spreadsheet row onto one of your accounts (or create a new one), fix any month that looks wrong, and
            uncheck rows you don't want — then import.
          </p>

          <div className="networth-import__months">
            <span className="networth-import__months-label">Months</span>
            <div className="networth-import__months-list">
              {parsed.months.map((month, index) => {
                const valid = isValidMonth(monthDrafts[index] ?? "");
                return (
                  <label
                    key={index}
                    className={`networth-import__month ${valid ? "" : "networth-import__month--invalid"}`}
                    title={`From "${month.raw || "(blank)"}"`}
                  >
                    <input
                      type="text"
                      value={monthDrafts[index] ?? ""}
                      placeholder="YYYY-MM"
                      aria-label={`Month for the "${month.raw}" column`}
                      onChange={(event) =>
                        setMonthDrafts((current) =>
                          current.map((value, valueIndex) => (valueIndex === index ? event.target.value : value)),
                        )
                      }
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="networth-import__rows">
            <div className="networth-import__row networth-import__row--head">
              <span />
              <span>Spreadsheet row</span>
              <span>Account</span>
              <span className="networth-import__row-count">Values</span>
            </div>
            {parsed.accounts.map((account, index) => {
              const draft = rowDrafts[index];
              const valueCount = account.amounts.filter(
                (amount, column) => amount !== null && isValidMonth(monthDrafts[column] ?? ""),
              ).length;
              const isNew = draft.target === NEW_ACCOUNT;
              const pillColor = colorForRow(draft.target, account.bucket);
              return (
                <div
                  key={index}
                  className={`networth-import__row ${draft.include ? "" : "networth-import__row--excluded"}`}
                >
                  <input
                    type="checkbox"
                    checked={draft.include}
                    aria-label={`Include ${account.label}`}
                    onChange={(event) => updateRow(index, { include: event.target.checked })}
                  />
                  <span className="networth-import__label">{account.label}</span>
                  <span className="import-shell__category-pill-wrap">
                    <select
                      key={draft.target}
                      className={`import-shell__category-select ${
                        isNew ? "import-shell__category-select--unclassified" : ""
                      }`}
                      value={draft.target}
                      aria-label={`Account for the "${account.label}" row`}
                      style={
                        isNew
                          ? undefined
                          : {
                              background: `color-mix(in srgb, ${pillColor} 18%, white)`,
                              borderColor: pillColor,
                              color: "#1f2937",
                              fontWeight: 400,
                              fontSize: "0.85rem",
                              lineHeight: 1.2,
                              borderRadius: 999,
                              padding: "0.45rem 0.7rem",
                              textAlign: "center",
                              WebkitAppearance: "none",
                              appearance: "none",
                              backgroundImage: "none",
                              textTransform: "none",
                            }
                      }
                      onChange={(event) => updateRow(index, { target: event.target.value })}
                    >
                      {accountGroups.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.accounts.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      <optgroup label="New account">
                        <option value={NEW_ACCOUNT}>Create “{account.label}”</option>
                      </optgroup>
                    </select>
                    {/* Hidden mirror of the selected label sizes the pill to its text (an
                        appearance:none select otherwise widens to its widest option). */}
                    <span className="import-shell__category-pill-mirror" aria-hidden="true">
                      {labelForTarget(draft.target)}
                    </span>
                  </span>
                  <span className="networth-import__row-count">{valueCount}</span>
                </div>
              );
            })}
          </div>

          {parsed.skipped.length > 0 && (
            <p className="networth-import__skipped">
              Set aside:{" "}
              {parsed.skipped.map((row, index) => (
                <span key={index}>
                  {index > 0 ? ", " : ""}
                  {row.label} <em>({SKIP_REASON_LABEL[row.reason]})</em>
                </span>
              ))}
            </p>
          )}

          <div className="networth-import__actions">
            <span className="networth-import__summary">
              {summary.balances > 0
                ? `${summary.balances} balance${summary.balances === 1 ? "" : "s"} · ${summary.accounts} account${
                    summary.accounts === 1 ? "" : "s"
                  } · ${summary.months} month${summary.months === 1 ? "" : "s"}`
                : "Nothing to import yet"}
            </span>
            <button type="button" className="networth-import__button" onClick={resetAll} disabled={isImporting}>
              Start over
            </button>
            <button
              type="button"
              className="networth-import__button networth-import__button--primary"
              onClick={handleImport}
              disabled={isImporting || summary.balances === 0}
            >
              {isImporting ? "Importing…" : "Import"}
            </button>
          </div>
        </>
      )}

      {error && <p className="networth-import__error">{error}</p>}
    </div>
  );
}

export default NetWorthImportModal;
