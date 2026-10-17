import type { ComponentProps } from "react";
import Modal from "../spending/Modal";
import CashFlowGroups from "./CashFlowGroups";

type CashFlowSettingsModalProps = {
  onClose: () => void;
  groups: ComponentProps<typeof CashFlowGroups>;
};

// The Cash Flow settings modal: organize buckets into groups (Taxes, Savings, Spending, ...).
function CashFlowSettingsModal({ onClose, groups }: CashFlowSettingsModalProps) {
  return (
    <Modal label="Cash flow groups" onClose={onClose}>
      <div className="manage-modal">
        <div className="manage-modal__body">
          <CashFlowGroups {...groups} />
        </div>
      </div>
    </Modal>
  );
}

export default CashFlowSettingsModal;
