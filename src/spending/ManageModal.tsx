import type { ComponentProps } from "react";
import Modal from "./Modal";
import BucketsAndCategories from "./BucketsAndCategories";

type ManageModalProps = {
  onClose: () => void;
  buckets: ComponentProps<typeof BucketsAndCategories>;
};

// The Spending-page settings modal: organize buckets & categories. Importing bank reports and
// managing banks live on the Upload page.
function ManageModal({ onClose, buckets }: ManageModalProps) {
  return (
    <Modal label="Buckets & Categories" onClose={onClose}>
      <div className="manage-modal">
        <div className="manage-modal__body">
          <BucketsAndCategories {...buckets} />
        </div>
      </div>
    </Modal>
  );
}

export default ManageModal;
