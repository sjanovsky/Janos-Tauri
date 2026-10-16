import { useState } from "react";
import Modal from "../spending/Modal";
import type { PaycheckRecord } from "./lib/income";

type PaycheckSettingsModalProps = {
  paycheck: PaycheckRecord;
  onClose: () => void;
  onUpdate: (
    patch: Partial<Pick<PaycheckRecord, "name" | "depositPattern" | "color">>,
  ) => void;
  onDelete: () => void;
};

// One paycheck's setup: what it's called, its color, and which deposits are filed under it.
// Changes save as you leave a field. Deleting asks twice.
function PaycheckSettingsModal({
  paycheck,
  onClose,
  onUpdate,
  onDelete,
}: PaycheckSettingsModalProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Modal label={`${paycheck.name} settings`} onClose={onClose}>
      <div className="pset">
        <h2>Paycheck settings</h2>

        <label className="pset__field">
          <span>Name</span>
          <div className="pset__row">
            <input
              type="color"
              aria-label="Color"
              value={paycheck.color}
              onChange={(event) => onUpdate({ color: event.target.value })}
            />
            <input
              defaultValue={paycheck.name}
              onBlur={(event) => {
                const name = event.target.value.trim();
                if (name && name !== paycheck.name) {
                  onUpdate({ name });
                } else {
                  event.target.value = paycheck.name;
                }
              }}
            />
          </div>
        </label>

        <label className="pset__field">
          <span>Deposit name contains</span>
          <input
            placeholder="e.g. ACME PAYROLL"
            defaultValue={paycheck.depositPattern}
            onBlur={(event) => {
              const depositPattern = event.target.value.trim();
              if (depositPattern !== paycheck.depositPattern) {
                onUpdate({ depositPattern });
              }
            }}
          />
          <small>
            New uploads whose description contains this text are filed under
            this paycheck. You can also pick it from the category menu on any
            deposit.
          </small>
        </label>

        <div className="pset__danger">
          {confirming ? (
            <>
              <span>
                Delete {paycheck.name} and all its versions? Its deposits become
                unclassified.
              </span>
              <button type="button" className="pset__delete" onClick={onDelete}>
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pset__delete-link"
              onClick={() => setConfirming(true)}
            >
              Delete paycheck…
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default PaycheckSettingsModal;
