import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ImportedTransaction } from "./lib/csvParser";
import { buildBankSummaries, type UploadedFileView } from "./lib/uploads";
import BankList from "./BankList";
import BankSettings from "./BankSettings";
import CustomImportPanel from "./CustomImportPanel";
import Modal from "../spending/Modal";
import TransactionList, { sortTransactions, type SortKey, type SortState } from "../spending/TransactionList";
import { normalizeBankName, type BankRecord } from "../spending/lib/banks";
import { buildCategoryOptionsByBucket } from "../spending/lib/categoryOptions";
import {
  UNCLASSIFIED_CATEGORY,
  applyCategoryRecords,
  deriveCategoryList,
  getCategoryBucketColor,
  getCategoryLabel,
  isReservedCategory,
  type BucketRecord,
  type Category,
  type CategoryRecord,
} from "../spending/lib/categories";

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

// The Upload page. Left pane: the banks with how far their data reaches, an Import button and a
// settings button (add banks, rename, logos). Right pane: the transaction list, filtered to the
// bank selected on the left. Owns the uploads and banks state and their persistence; Spending,
// Income and Overview re-read the stored data when their tab opens.
function UploadPage() {
  const [uploads, setUploads] = useState<UploadedFileView[]>([]);
  const [bankRecords, setBankRecords] = useState<BankRecord[]>([]);
  const [categoryRecords, setCategoryRecords] = useState<CategoryRecord[]>([]);
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [selectedBankKey, setSelectedBankKey] = useState<string | null>(null);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<SortState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    invoke<UploadedFileView[]>("list_uploads")
      .then(setUploads)
      .catch((error) => {
        console.error("Failed to load uploads from the database", error);
        setDbError("Couldn't load your uploads from the database.");
      });
    invoke<BankRecord[]>("list_banks")
      .then(setBankRecords)
      .catch((error) => {
        console.error("Failed to load banks from the database", error);
        setDbError("Couldn't load your banks from the database.");
      });
    invoke<CategoryRecord[]>("list_categories")
      .then(setCategoryRecords)
      .catch((error) => {
        console.error("Failed to load categories from the database", error);
        setDbError("Couldn't load your categories from the database.");
      });
    invoke<BucketRecord[]>("list_buckets")
      .then(setBuckets)
      .catch((error) => {
        console.error("Failed to load buckets from the database", error);
        setDbError("Couldn't load your buckets from the database.");
      });
  }, []);

  // Keep the shared label lookup in sync during render so getCategoryLabel is fresh below.
  useMemo(() => applyCategoryRecords(categoryRecords), [categoryRecords]);

  // Current categories (id + label) used to match imported category text back to an existing
  // category instead of creating a duplicate.
  const knownCategories = useMemo(() => {
    const recordIds = categoryRecords.map((record) => record.id);
    const known = categoryRecords.map((record) => ({ id: record.id, label: record.label }));
    const transactions = uploads.flatMap((upload) => upload.transactions);
    const defined = new Set(recordIds);
    deriveCategoryList(transactions, recordIds).forEach((id) => {
      if (!defined.has(id) && !isReservedCategory(id)) {
        known.push({ id, label: getCategoryLabel(id) });
      }
    });
    return known;
  }, [categoryRecords, uploads]);

  const masterTransactions = useMemo(() => uploads.flatMap((upload) => upload.transactions), [uploads]);
  const bankSummaries = useMemo(() => buildBankSummaries(uploads, bankRecords), [uploads, bankRecords]);
  const selectedBank = bankSummaries.find((bank) => bank.key === selectedBankKey) ?? null;

  const selectedUpload = useMemo(
    () => uploads.find((upload) => upload.id === selectedUploadId) ?? null,
    [uploads, selectedUploadId],
  );

  // An upload narrows the list to just its transactions; otherwise a bank shows everything
  // imported for it.
  const tableTransactions = useMemo(() => {
    if (selectedUpload) {
      return selectedUpload.transactions;
    }
    return selectedBankKey
      ? masterTransactions.filter((transaction) => normalizeBankName(transaction.sourceBank) === selectedBankKey)
      : masterTransactions;
  }, [masterTransactions, selectedBankKey, selectedUpload]);

  const handleSelectBank = (key: string) => {
    // Clicking the bank again clears the filter; from an upload it widens back to the bank.
    if (key === selectedBankKey && !selectedUploadId) {
      setSelectedBankKey(null);
    } else {
      setSelectedBankKey(key);
    }
    setSelectedUploadId(null);
  };

  const handleSelectUpload = (bankKey: string, uploadId: string) => {
    if (uploadId === selectedUploadId) {
      setSelectedUploadId(null);
      return;
    }
    setSelectedBankKey(bankKey);
    setSelectedUploadId(uploadId);
  };

  const clearSelection = () => {
    setSelectedBankKey(null);
    setSelectedUploadId(null);
  };

  const sortedTransactions = useMemo(
    () => (tableSort ? sortTransactions(tableTransactions, tableSort) : tableTransactions),
    // categoryRecords is a dependency because sorting by category uses its (possibly renamed) label.
    [tableTransactions, tableSort, categoryRecords],
  );

  const tableTotal = useMemo(
    () => sortedTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
    [sortedTransactions],
  );

  const categoryList = useMemo(() => {
    const defined = deriveCategoryList(masterTransactions, categoryRecords.map((record) => record.id));
    return masterTransactions.some((transaction) => transaction.category === UNCLASSIFIED_CATEGORY)
      ? [...defined, UNCLASSIFIED_CATEGORY]
      : defined;
  }, [masterTransactions, categoryRecords]);

  const excludedCategories = useMemo(
    () => new Set(categoryRecords.filter((record) => record.excluded).map((record) => record.id)),
    [categoryRecords],
  );

  const bucketColorByCategory = useMemo(
    () =>
      Object.fromEntries(
        categoryList.map((category) => [category, getCategoryBucketColor(category, categoryRecords, buckets)]),
      ),
    [buckets, categoryList, categoryRecords],
  );

  const categoryOptionsByBucket = useMemo(
    () => buildCategoryOptionsByBucket(categoryList, categoryRecords, buckets),
    [buckets, categoryList, categoryRecords],
  );

  const toggleSort = (key: SortKey) => {
    setTableSort((current) =>
      current && current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  const handleCategoryChange = (transactionId: string, category: Category) => {
    setUploads((current) =>
      current.map((upload) => ({
        ...upload,
        transactions: upload.transactions.map((transaction) =>
          transaction.id === transactionId ? { ...transaction, category, autoCategorized: false } : transaction,
        ),
      })),
    );

    invoke("update_transaction_category", { transactionId, category }).catch((error) => {
      console.error("Failed to save category change", error);
      setDbError("Couldn't save that category change to the database.");
    });
  };

  // Marks auto-categorized transactions as reviewed so they stop being highlighted.
  const handleConfirmAutoCategorized = (transactionIds: string[]) => {
    if (transactionIds.length === 0) {
      return;
    }
    const idSet = new Set(transactionIds);
    const previousUploads = uploads;
    setUploads((current) =>
      current.map((upload) => ({
        ...upload,
        transactions: upload.transactions.map((transaction) =>
          idSet.has(transaction.id) ? { ...transaction, autoCategorized: false } : transaction,
        ),
      })),
    );

    invoke("confirm_auto_categorized", { transactionIds }).catch((error) => {
      console.error("Failed to confirm auto-categorized transactions", error);
      setDbError("Couldn't save that review to the database.");
      setUploads(previousUploads);
    });
  };

  const handleBulkCategoryChange = (transactionIds: string[], category: Category) => {
    if (transactionIds.length === 0) {
      return;
    }
    const idSet = new Set(transactionIds);
    setUploads((current) =>
      current.map((upload) => ({
        ...upload,
        transactions: upload.transactions.map((transaction) =>
          idSet.has(transaction.id) ? { ...transaction, category, autoCategorized: false } : transaction,
        ),
      })),
    );

    invoke("update_transaction_categories", { transactionIds, category }).catch((error) => {
      console.error("Failed to save bulk category change", error);
      setDbError("Couldn't save those category changes to the database.");
    });
  };

  const persistUpload = async (
    bankName: string,
    fileName: string,
    transactions: ImportedTransaction[],
  ): Promise<boolean> => {
    const upload: UploadedFileView = {
      id: `${fileName}-${crypto.randomUUID()}`,
      bankName,
      fileName,
      // The DB fills imported_at via its default; mirror it here for the optimistic row.
      importedAt: new Date().toISOString(),
      transactions,
    };

    try {
      await invoke("add_upload", {
        id: upload.id,
        bankName: upload.bankName,
        fileName: upload.fileName,
        transactions: upload.transactions,
      });
      // Income rules run as the upload is stored, so re-read it to show their categories.
      const stored = await invoke<UploadedFileView[]>("list_uploads").catch(() => null);
      setUploads(stored ?? ((current) => [upload, ...current]));
      // Show the new file's rows (with anything auto-categorized highlighted) right away.
      setSelectedBankKey(normalizeBankName(bankName));
      setSelectedUploadId(upload.id);
      return true;
    } catch (error) {
      console.error("Failed to save upload to the database", error);
      setDbError("Couldn't save that upload to the database.");
      return false;
    }
  };

  const handleDeleteUpload = async (uploadId: string) => {
    setSelectedUploadId((current) => (current === uploadId ? null : current));
    const previousUploads = uploads;
    setUploads((current) => current.filter((upload) => upload.id !== uploadId));

    try {
      await invoke("delete_upload", { id: uploadId });
    } catch (error) {
      console.error("Failed to delete upload from the database", error);
      setDbError("Couldn't delete that upload from the database.");
      setUploads(previousUploads);
    }
  };

  const handleRenameUpload = (uploadId: string, fileName: string) => {
    const previousUploads = uploads;
    setUploads((current) =>
      current.map((upload) => (upload.id === uploadId ? { ...upload, fileName } : upload)),
    );

    invoke("rename_upload", { id: uploadId, fileName }).catch((error) => {
      console.error("Failed to rename the upload in the database", error);
      setDbError("Couldn't save that file name change to the database.");
      setUploads(previousUploads);
    });
  };

  const handleAddBank = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    const previousBanks = bankRecords;
    const id = crypto.randomUUID();
    setBankRecords((current) => [...current, { id, name: trimmed, logoDataUrl: null, spendingPositive: true }]);

    invoke("upsert_bank", { id, name: trimmed, logoDataUrl: null }).catch((error) => {
      console.error("Failed to save the new bank to the database", error);
      setDbError("Couldn't save that bank to the database.");
      setBankRecords(previousBanks);
    });
  };

  const handleUpdateBank = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    const previousBanks = bankRecords;
    const current = bankRecords.find((bank) => bank.id === id);
    setBankRecords((records) =>
      records.map((bank) => (bank.id === id ? { ...bank, name: trimmed } : bank)),
    );

    invoke("upsert_bank", { id, name: trimmed, logoDataUrl: current?.logoDataUrl ?? null }).catch((error) => {
      console.error("Failed to save the bank rename to the database", error);
      setDbError("Couldn't save that bank change to the database.");
      setBankRecords(previousBanks);
    });
  };

  const handleDeleteBank = (id: string) => {
    const previousBanks = bankRecords;
    setBankRecords((current) => current.filter((bank) => bank.id !== id));

    invoke("delete_bank", { id }).catch((error) => {
      console.error("Failed to delete the bank from the database", error);
      setDbError("Couldn't delete that bank from the database.");
      setBankRecords(previousBanks);
    });
  };

  const handleSetBankLogo = (id: string, logoDataUrl: string | null) => {
    const previousBanks = bankRecords;
    const name = bankRecords.find((bank) => bank.id === id)?.name ?? "";
    if (!name) {
      return;
    }
    setBankRecords((current) =>
      current.map((bank) => (bank.id === id ? { ...bank, logoDataUrl } : bank)),
    );

    invoke("upsert_bank", { id, name, logoDataUrl }).catch((error) => {
      console.error("Failed to save the bank logo to the database", error);
      setDbError("Couldn't save that bank logo to the database.");
      setBankRecords(previousBanks);
    });
  };

  return (
    <>
      {dbError && <div className="import-shell__db-error">{dbError}</div>}
      <section className="import-shell__panel">
        <div className="import-shell__master-layout">
          <div className="import-shell__chart-card">
            <div className="import-shell__chart-header">
              <div>
                <h2>Banks</h2>
              </div>
              <div className="import-shell__chart-tools">
                <button
                  type="button"
                  className="import-shell__settings-button"
                  aria-label="Open bank settings"
                  title="Bank settings"
                  onClick={() => setSettingsOpen(true)}
                >
                  <GearIcon />
                </button>
              </div>
            </div>

            <CustomImportPanel
              onImport={persistUpload}
              knownCategories={knownCategories}
              bankRecords={bankRecords}
            />

            <BankList
              banks={bankSummaries}
              selectedKey={selectedBankKey}
              selectedUploadId={selectedUploadId}
              onSelect={handleSelectBank}
              onSelectUpload={handleSelectUpload}
              onDeleteUpload={handleDeleteUpload}
              onRenameUpload={handleRenameUpload}
            />
          </div>

          <TransactionList
            transactions={sortedTransactions}
            total={tableTotal}
            hasAnyTransactions={masterTransactions.length > 0}
            selectedBucketKey={null}
            selectedCategory={null}
            selectedBucketId={selectedBank?.key ?? selectedUpload?.id ?? null}
            selectedBucketLabel={null}
            selectedBucketName={
              selectedUpload
                ? `${selectedBank?.name ?? selectedUpload.bankName} · ${selectedUpload.fileName}`
                : selectedBank?.name ?? null
            }
            onClearFilter={clearSelection}
            sort={tableSort}
            onToggleSort={toggleSort}
            categoryList={categoryList}
            excludedCategoryIds={excludedCategories}
            bucketColorByCategory={bucketColorByCategory}
            categoryOptionsByBucket={categoryOptionsByBucket}
            bankRecords={bankRecords}
            onCategoryChange={handleCategoryChange}
            onBulkCategoryChange={handleBulkCategoryChange}
            onConfirmAutoCategorized={handleConfirmAutoCategorized}
          />
        </div>
      </section>

      {settingsOpen && (
        <Modal label="Bank settings" onClose={() => setSettingsOpen(false)}>
          <BankSettings
            banks={bankRecords}
            onAddBank={handleAddBank}
            onUpdateBank={handleUpdateBank}
            onDeleteBank={handleDeleteBank}
            onSetBankLogo={handleSetBankLogo}
          />
        </Modal>
      )}
    </>
  );
}

export default UploadPage;
