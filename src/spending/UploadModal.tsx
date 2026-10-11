import { type ComponentProps } from "react";
import Modal from "./Modal";
import BankReportUpload from "./BankReportUpload";

type UploadModalProps = ComponentProps<typeof BankReportUpload> & {
  onClose: () => void;
};

// The Spending-page "Upload" button opens the bank-report upload flow in a modal.
function UploadModal({ onClose, ...uploadProps }: UploadModalProps) {
  return (
    <Modal label="Upload bank report" onClose={onClose}>
      <BankReportUpload {...uploadProps} />
    </Modal>
  );
}

export default UploadModal;
