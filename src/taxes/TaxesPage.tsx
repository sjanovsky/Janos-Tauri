import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./taxes.css";
import { LinesPanel, TaxLinesPanel } from "./TaxesInputs";
import TaxesResults from "./TaxesResults";
import TaxesSettingsModal from "./TaxesSettingsModal";
import {
  computeFederal,
  projectItem,
  taxTableFor,
  type TaxItemRecord,
  type TaxLineField,
  type TaxSection,
  type TaxesData,
} from "./lib/taxes";

const DB_ERROR = "Couldn't reach the local database. Make sure the app is running via `npm run tauri dev`.";

const EMPTY: TaxesData = { years: [], items: [], householdValues: [] };

// The Taxes page: a household's projected federal tax for one year. Inputs on the left (per-person
// paycheck numbers, other income, tax lines), live results on the right. All state lives here and
// is persisted through the taxes_* Tauri commands with optimistic updates; on any failure the page
// reloads from the database so the screen never drifts from what's saved.
function TaxesPage() {
  const [data, setData] = useState<TaxesData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      invoke<TaxesData>("get_taxes_data")
        .then((next) => {
          setData(next);
          setLoaded(true);
          setDbError(null);
          return next;
        })
        .catch((error) => {
          console.error("Failed to load taxes from the database", error);
          setDbError(DB_ERROR);
          return null;
        }),
    [],
  );

  // First load: make sure at least the current year exists, then show the most recent year.
  useEffect(() => {
    void (async () => {
      const first = await reload();
      if (first && first.years.length === 0) {
        await invoke("add_taxes_year", { year: new Date().getFullYear() }).catch(() => undefined);
        await reload();
      } else if (first) {
        const current = new Date().getFullYear();
        setYear(first.years.includes(current) ? current : first.years[first.years.length - 1]);
      }
    })();
  }, [reload]);

  // Run a persistence call; on failure surface the error and resync from the database.
  const persist = useCallback(
    (command: string, args: Record<string, unknown>) => {
      invoke(command, args).catch((error) => {
        console.error(`Failed to save (${command})`, error);
        setDbError(DB_ERROR);
        void reload();
      });
    },
    [reload],
  );

  // --- Derived for the selected year ---

  const householdValues = useMemo(() => {
    const values: Partial<Record<TaxLineField, number>> = {};
    data.householdValues
      .filter((record) => record.year === year)
      .forEach((record) => {
        values[record.field as TaxLineField] = record.value;
      });
    return values;
  }, [data.householdValues, year]);

  // The year's lines, grouped by section and ordered as entered.
  const itemsFor = useCallback(
    (section: TaxSection) =>
      data.items
        .filter((item) => item.year === year && item.section === section)
        .sort((a, b) => a.position - b.position),
    [data.items, year],
  );
  const incomeItems = useMemo(() => itemsFor("income"), [itemsFor]);
  const deductionItems = useMemo(() => itemsFor("deduction"), [itemsFor]);
  const withholdingItems = useMemo(() => itemsFor("withholding"), [itemsFor]);
  const sumOf = (items: TaxItemRecord[]) => items.reduce((total, item) => total + projectItem(item), 0);

  const yearItems = useMemo(() => data.items.filter((item) => item.year === year), [data.items, year]);

  const { table, exact } = taxTableFor(year);
  const result = useMemo(
    () => computeFederal({ table, items: yearItems, taxLines: householdValues }),
    [table, yearItems, householdValues],
  );

  const years = useMemo(() => [...data.years].sort((a, b) => a - b), [data.years]);

  // --- Years ---

  const handleAddYear = async (next: number) => {
    await invoke("add_taxes_year", { year: next }).catch((error) => {
      console.error("Failed to add the year", error);
      setDbError(DB_ERROR);
    });
    await reload();
    setYear(next);
  };

  const handleDeleteYear = async (target: number) => {
    const remaining = years.filter((value) => value !== target);
    if (remaining.length === 0) {
      return;
    }
    await invoke("delete_taxes_year", { year: target }).catch((error) => {
      console.error("Failed to delete the year", error);
      setDbError(DB_ERROR);
    });
    await reload();
    if (target === year) {
      setYear(remaining[remaining.length - 1]);
    }
  };

  const itemCountByYear = useMemo(() => {
    const counts: Record<number, number> = {};
    data.items.forEach((item) => {
      counts[item.year] = (counts[item.year] ?? 0) + 1;
    });
    return counts;
  }, [data.items]);

  // --- Household tax lines ---

  const handleTaxLine = (field: TaxLineField, value: number, shouldPersist: boolean) => {
    setData((current) => {
      const exists = current.householdValues.some((record) => record.year === year && record.field === field);
      return {
        ...current,
        householdValues: exists
          ? current.householdValues.map((record) =>
              record.year === year && record.field === field ? { ...record, value } : record,
            )
          : [...current.householdValues, { year, field, value }],
      };
    });
    if (shouldPersist) {
      persist("set_taxes_household_value", { year, field, value });
    }
  };

  // --- Lines (income, deductions, withholdings) ---

  const handleAddItem = (section: TaxSection, name: string) => {
    const id = crypto.randomUUID();
    const position =
      data.items
        .filter((item) => item.year === year && item.section === section)
        .reduce((max, item) => Math.max(max, item.position), -1) + 1;
    const item: TaxItemRecord = { id, year, section, name, ytd: 0, lastPaycheck: 0, paychecksLeft: 0, position };
    setData((current) => ({ ...current, items: [...current.items, item] }));
    persist("upsert_taxes_item", { id, year, section, name, ytd: 0, lastPaycheck: 0, paychecksLeft: 0 });
  };

  const handleChangeItem = (
    id: string,
    changes: Partial<Pick<TaxItemRecord, "name" | "ytd" | "lastPaycheck" | "paychecksLeft">>,
    shouldPersist: boolean,
  ) => {
    const current = data.items.find((item) => item.id === id);
    if (!current) {
      return;
    }
    const next = { ...current, ...changes };
    setData((state) => ({
      ...state,
      items: state.items.map((item) => (item.id === id ? next : item)),
    }));
    if (shouldPersist) {
      persist("upsert_taxes_item", {
        id,
        year,
        section: next.section,
        name: next.name,
        ytd: next.ytd,
        lastPaycheck: next.lastPaycheck,
        paychecksLeft: next.paychecksLeft,
      });
    }
  };

  const handleDeleteItem = (id: string) => {
    setData((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
    persist("delete_taxes_item", { id });
  };

  return (
    <>
      {dbError && <div className="import-shell__db-error">{dbError}</div>}
      <section className="taxes-page">
        {!loaded ? null : (
          <div className="taxes-body">
            <div className="taxes-column">
              <LinesPanel
                title="Income"
                tone="green"
                description="Paychecks and anything else that counts as income. For a one-off amount like interest, just fill in Year to date."
                addLabel="+ Add income"
                emptyText="No income yet."
                items={incomeItems}
                total={sumOf(incomeItems)}
                onAdd={() => handleAddItem("income", "New income")}
                onChange={handleChangeItem}
                onDelete={handleDeleteItem}
              />

              <LinesPanel
                title="Deductions"
                tone="blue"
                description="Pre-tax contributions that reduce taxable income, projected through year-end."
                addLabel="+ Add deduction"
                emptyText="No deductions yet."
                items={deductionItems}
                total={sumOf(deductionItems)}
                onAdd={() => handleAddItem("deduction", "New deduction")}
                onChange={handleChangeItem}
                onDelete={handleDeleteItem}
              />

              <LinesPanel
                title="Withholdings"
                tone="amber"
                description="Federal income tax already withheld from paychecks, projected through year-end."
                addLabel="+ Add withholding"
                emptyText="No withholdings yet."
                items={withholdingItems}
                total={sumOf(withholdingItems)}
                onAdd={() => handleAddItem("withholding", "New withholding")}
                onChange={handleChangeItem}
                onDelete={handleDeleteItem}
              />

              <TaxLinesPanel values={householdValues} onChange={handleTaxLine} />
            </div>

            <div className="taxes-column">
              <TaxesResults
                result={result}
                year={year}
                tableExact={exact}
                tableYear={table.year}
                years={years}
                onSelectYear={setYear}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </div>
          </div>
        )}
      </section>

      {settingsOpen && (
        <TaxesSettingsModal
          onClose={() => setSettingsOpen(false)}
          years={{
            years,
            itemCountByYear,
            onAddYear: (next) => void handleAddYear(next),
            onDeleteYear: (target) => void handleDeleteYear(target),
          }}
        />
      )}
    </>
  );
}

export default TaxesPage;

