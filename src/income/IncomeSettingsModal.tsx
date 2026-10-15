import { useState } from "react";
import Modal from "../spending/Modal";
import { BUCKET_COLOR_PALETTE, type CategoryRecord } from "../spending/lib/categories";
import "./income.css";

type IncomeSettingsModalProps = {
  categories: CategoryRecord[];
  onClose: () => void;
  onAddCategory: (label: string, color: string) => void;
  onUpdateCategory: (id: string, label: string, color: string) => void;
  onDeleteCategory: (id: string) => void;
};

// Manage the plain income categories (Commission, Bonus, plus anything the user adds). Paychecks
// are managed on the Paychecks tab and are also offered in the category menu on each deposit.
function IncomeSettingsModal({
  categories,
  onClose,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
}: IncomeSettingsModalProps) {
  const [newCategory, setNewCategory] = useState("");

  const addCategory = () => {
    const label = newCategory.trim();
    if (!label) {
      return;
    }
    onAddCategory(label, BUCKET_COLOR_PALETTE[categories.length % BUCKET_COLOR_PALETTE.length]);
    setNewCategory("");
  };

  return (
    <Modal label="Income categories" onClose={onClose}>
      <div className="income-settings">
        <section className="income-settings__section">
          <h3>Categories</h3>
          <p>Deposits filed under these categories make up the Income page.</p>
          <ul className="income-settings__list">
            {categories.map((category) => (
              <li key={category.id} className="income-settings__row">
                <input
                  type="color"
                  aria-label={`${category.label} color`}
                  value={category.color}
                  onChange={(event) => onUpdateCategory(category.id, category.label, event.target.value)}
                />
                <input
                  className="income-settings__text"
                  aria-label="Category name"
                  defaultValue={category.label}
                  onBlur={(event) => {
                    const label = event.target.value.trim();
                    if (label && label !== category.label) {
                      onUpdateCategory(category.id, label, category.color);
                    } else {
                      event.target.value = category.label;
                    }
                  }}
                />
                <button
                  type="button"
                  className="income-settings__delete"
                  aria-label={`Delete ${category.label}`}
                  onClick={() => onDeleteCategory(category.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form
            className="income-settings__add"
            onSubmit={(event) => {
              event.preventDefault();
              addCategory();
            }}
          >
            <input
              className="income-settings__text"
              placeholder="New category, e.g. Side income"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
            />
            <button type="submit" disabled={!newCategory.trim()}>
              Add category
            </button>
          </form>
        </section>
      </div>
    </Modal>
  );
}

export default IncomeSettingsModal;
