import { invoke } from "@tauri-apps/api/core";
import { nextBucketColor, type AccountRecord, type NetWorthBucketRecord } from "./networth";

type Options = {
  buckets: NetWorthBucketRecord[];
  setBuckets: React.Dispatch<React.SetStateAction<NetWorthBucketRecord[]>>;
  accounts: AccountRecord[];
  setAccounts: React.Dispatch<React.SetStateAction<AccountRecord[]>>;
  onError: () => void;
  // Called when an account is deleted so the caller can drop what hung off it (its balances);
  // returns a function that undoes that if saving fails.
  onAccountRemoved?: (id: string) => () => void;
};

// The edit handlers behind the Accounts & buckets board, shared by every page that shows it. Each
// updates state straight away and rolls back if the database write fails.
export function useNetWorthAccounts({
  buckets,
  setBuckets,
  accounts,
  setAccounts,
  onError,
  onAccountRemoved,
}: Options) {
  // --- Buckets ---

  const handleAddBucket = (name: string) => {
    const previous = buckets;
    const id = crypto.randomUUID();
    const color = nextBucketColor(buckets.length);
    const position = buckets.reduce((max, bucket) => Math.max(max, bucket.position), -1) + 1;
    setBuckets((current) => [...current, { id, name, color, position }]);

    invoke("upsert_networth_bucket", { id, name, color }).catch((error) => {
      console.error("Failed to save the new bucket", error);
      onError();
      setBuckets(previous);
    });
  };

  const handleRenameBucket = (id: string, name: string) => {
    const previous = buckets;
    const color = buckets.find((bucket) => bucket.id === id)?.color ?? nextBucketColor(buckets.length);
    setBuckets((current) => current.map((bucket) => (bucket.id === id ? { ...bucket, name } : bucket)));

    invoke("upsert_networth_bucket", { id, name, color }).catch((error) => {
      console.error("Failed to rename the bucket", error);
      onError();
      setBuckets(previous);
    });
  };

  const handleSetBucketColor = (id: string, color: string) => {
    const previous = buckets;
    const name = buckets.find((bucket) => bucket.id === id)?.name;
    if (name === undefined) {
      return;
    }
    setBuckets((current) => current.map((bucket) => (bucket.id === id ? { ...bucket, color } : bucket)));

    invoke("upsert_networth_bucket", { id, name, color }).catch((error) => {
      console.error("Failed to save the bucket color", error);
      onError();
      setBuckets(previous);
    });
  };

  const handleDeleteBucket = (id: string) => {
    const previousBuckets = buckets;
    const previousAccounts = accounts;
    setBuckets((current) => current.filter((bucket) => bucket.id !== id));
    // The accounts stay; they just fall back to the Ungrouped tray (matching the DB's SET NULL).
    setAccounts((current) =>
      current.map((account) => (account.bucketId === id ? { ...account, bucketId: null } : account)),
    );

    invoke("delete_networth_bucket", { id }).catch((error) => {
      console.error("Failed to delete the bucket", error);
      onError();
      setBuckets(previousBuckets);
      setAccounts(previousAccounts);
    });
  };

  const handleReorderBuckets = (orderedIds: string[]) => {
    const previous = buckets;
    const positionById = new Map(orderedIds.map((id, index) => [id, index]));
    setBuckets((current) =>
      current.map((bucket) =>
        positionById.has(bucket.id) ? { ...bucket, position: positionById.get(bucket.id)! } : bucket,
      ),
    );

    invoke("set_networth_bucket_positions", { ids: orderedIds }).catch((error) => {
      console.error("Failed to save the bucket order", error);
      onError();
      setBuckets(previous);
    });
  };

  // --- Accounts ---

  const handleAddAccount = (name: string) => {
    const previous = accounts;
    const id = crypto.randomUUID();
    const position = accounts.reduce((max, account) => Math.max(max, account.position), -1) + 1;
    setAccounts((current) => [...current, { id, name, bucketId: null, position }]);

    invoke("upsert_networth_account", { id, name }).catch((error) => {
      console.error("Failed to save the new account", error);
      onError();
      setAccounts(previous);
    });
  };

  const handleRenameAccount = (id: string, name: string) => {
    const previous = accounts;
    setAccounts((current) => current.map((account) => (account.id === id ? { ...account, name } : account)));

    invoke("upsert_networth_account", { id, name }).catch((error) => {
      console.error("Failed to rename the account", error);
      onError();
      setAccounts(previous);
    });
  };

  const handleDeleteAccount = (id: string) => {
    const previousAccounts = accounts;
    setAccounts((current) => current.filter((account) => account.id !== id));
    const undoExtras = onAccountRemoved?.(id);

    invoke("delete_networth_account", { id }).catch((error) => {
      console.error("Failed to delete the account", error);
      onError();
      setAccounts(previousAccounts);
      undoExtras?.();
    });
  };

  // Move an account into a bucket (or back to Ungrouped), optionally reordering that bucket.
  const handlePlaceAccount = (accountId: string, bucketId: string | null, orderedBucketIds?: string[]) => {
    const previous = accounts;
    const existing = accounts.find((account) => account.id === accountId);
    const name = existing?.name ?? "";
    const positionById = orderedBucketIds ? new Map(orderedBucketIds.map((id, index) => [id, index])) : null;

    setAccounts((current) => {
      const withMoved = current.map((account) =>
        account.id === accountId ? { ...account, bucketId } : account,
      );
      return positionById
        ? withMoved.map((account) =>
            positionById.has(account.id) ? { ...account, position: positionById.get(account.id)! } : account,
          )
        : withMoved;
    });

    invoke("set_networth_account_placement", { id: accountId, name, bucketId })
      .then(() => (orderedBucketIds ? invoke("set_networth_account_positions", { ids: orderedBucketIds }) : undefined))
      .catch((error) => {
        console.error("Failed to save the account placement", error);
        onError();
        setAccounts(previous);
      });
  };

  return {
    accounts,
    buckets,
    onAddAccount: handleAddAccount,
    onRenameAccount: handleRenameAccount,
    onDeleteAccount: handleDeleteAccount,
    onAddBucket: handleAddBucket,
    onRenameBucket: handleRenameBucket,
    onSetBucketColor: handleSetBucketColor,
    onDeleteBucket: handleDeleteBucket,
    onReorderBuckets: handleReorderBuckets,
    onPlaceAccount: handlePlaceAccount,
  };
}
