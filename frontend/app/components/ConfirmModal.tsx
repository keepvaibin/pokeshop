"use client";

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmDisabled = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmDisabled) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmDisabled, onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={() => {
        if (!confirmDisabled) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-md border border-pkmn-border bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center bg-red-50 text-red-600">
            <TriangleAlert className="h-5 w-5" />
          </div>
          <div>
            <h2 id="confirm-modal-title" className="text-lg font-bold text-pkmn-text">
              {title}
            </h2>
            <p className="mt-2 text-sm text-pkmn-gray">{description}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={confirmDisabled}
            className="inline-flex items-center justify-center border border-pkmn-border px-4 py-2.5 text-sm font-heading font-bold text-pkmn-text transition-colors hover:bg-pkmn-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="inline-flex items-center justify-center bg-pkmn-red px-4 py-2.5 text-sm font-heading font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {confirmDisabled ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}