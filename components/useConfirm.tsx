'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

/**
 * In-page replacement for window.confirm() — a native confirm dialog is
 * easy to dismiss by reflex on a phone (the exact device every
 * destructive action in this app is actually clicked from), and doesn't
 * let the message wrap or style itself. Same async-boolean shape as
 * window.confirm() so call sites barely change: `if (!window.confirm(m))`
 * becomes `if (!(await confirm(m)))`, plus rendering the returned dialog
 * once somewhere in the page.
 */
export function useConfirm(): [(message: string) => Promise<boolean>, ReactNode] {
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((msg: string) => {
    setMessage(msg);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const respond = (value: boolean) => {
    setMessage(null);
    resolver.current?.(value);
    resolver.current = null;
  };

  const dialog: ReactNode = message ? (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={() => respond(false)}
    >
      <div onClick={(e) => e.stopPropagation()} className="bg-surface rounded-lg shadow-xl max-w-sm w-full p-5">
        <p className="text-sm text-ink whitespace-pre-line">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => respond(false)} className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent-tint">
            Cancel
          </button>
          <button
            onClick={() => respond(true)}
            className="px-3 py-1.5 bg-red-600 text-white rounded-md text-sm hover:bg-red-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, dialog];
}
