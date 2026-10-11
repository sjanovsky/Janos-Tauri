import { type ComponentProps } from "react";
import Modal from "./Modal";
import BucketsAndCategories from "./BucketsAndCategories";

type BucketsModalProps = ComponentProps<typeof BucketsAndCategories> & {
  onClose: () => void;
};

// The Spending-page gear button opens bucket/category management in a modal.
function BucketsModal({ onClose, ...bucketsProps }: BucketsModalProps) {
  return (
    <Modal label="Buckets and categories" onClose={onClose}>
      <BucketsAndCategories {...bucketsProps} />
    </Modal>
  );
}

export default BucketsModal;
