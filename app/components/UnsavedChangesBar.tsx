"use client";

import { useEffect, useState } from 'react';
import { Save, X } from 'lucide-react';

interface UnsavedChangesBarProps {
  show: boolean;
  saving?: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export default function UnsavedChangesBar({ show, saving, onSave, onCancel }: UnsavedChangesBarProps) {
  const [visible, setVisible] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    if (show) {
      // Make element visible first, then animate in on next frame
      const raf1 = requestAnimationFrame(() => {
        setVisible(true);
        const raf2 = requestAnimationFrame(() => setAnimateIn(true));
        return () => cancelAnimationFrame(raf2);
      });
      return () => cancelAnimationFrame(raf1);
    } else {
      const raf = requestAnimationFrame(() => setAnimateIn(false));
      const timer = setTimeout(() => setVisible(false), 300);
      return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
    }
  }, [show]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div
        className={`pointer-events-auto mb-6 flex items-center gap-3 border border-pkmn-border bg-white px-5 py-3 shadow-lg transition-all duration-300 ease-out ${
          animateIn ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'
        }`}
      >
        <span className="text-sm font-semibold text-pkmn-text">Save changes?</span>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-pkmn-blue px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-pkmn-blue-dark disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? 'Saving…' : 'Yes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md border border-pkmn-border bg-white px-4 py-2 text-xs font-bold text-pkmn-gray transition-colors hover:bg-pkmn-bg disabled:opacity-50"
        >
          <X size={14} />
          Cancel
        </button>
      </div>
    </div>
  );
}
