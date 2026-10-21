import type { ReactNode } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";

export function AppDialog({
  label,
  onClose,
  busy = false,
  wide = false,
  children,
}: {
  label: string;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 motion-safe:backdrop-blur-sm"
    >
      <Modal className={wide ? "w-[640px] max-w-full" : "w-[550px] max-w-full"}>
        <Dialog
          aria-label={label}
          className="modal w-full max-w-full rounded-lg border border-line bg-surface text-ink shadow-xl outline-none"
        >
          <p className="sr-only" role="status">
            {busy ? "Working. Please wait before closing this dialog." : ""}
          </p>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
