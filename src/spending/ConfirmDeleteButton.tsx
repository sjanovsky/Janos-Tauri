import { useState } from "react";
import { TrashIcon } from "./BucketsAndCategories";

type ConfirmDeleteButtonProps = {
  // What is being deleted, e.g. "group Taxes".
  what: string;
  // What happens to the things inside it, shown in the confirmation.
  consequence: string;
  onConfirm: () => void;
};

// A trash button that asks first: clicking it swaps in "Delete? Yes / No" with what will happen to
// the contents, so it's clear which row is being deleted and nothing goes by accident.
function ConfirmDeleteButton({ what, consequence, onConfirm }: ConfirmDeleteButtonProps) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        className="import-shell__upload-delete bucket-row__delete"
        aria-label={`Delete ${what}`}
        title={`Delete ${what}`}
        onClick={() => setAsking(true)}
      >
        <TrashIcon />
      </button>
    );
  }
  return (
    <div className="confirm-delete" role="alertdialog" aria-label={`Delete ${what}?`}>
      <span className="confirm-delete__text">
        Delete {what}? {consequence}
      </span>
      <button
        type="button"
        className="confirm-delete__yes"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Delete
      </button>
      <button type="button" className="confirm-delete__no" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </div>
  );
}

export default ConfirmDeleteButton;
