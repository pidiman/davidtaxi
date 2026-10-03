import { type ReactNode, useEffect, useRef } from 'react';

/** Natívny <dialog>: Esc zatvára, focus ostáva vnútri, funguje aj na mobile. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(640px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] rounded-2xl border border-line bg-panel p-0 text-text backdrop:bg-black/70"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-5 py-4">
        <h2 className="h2">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zavrieť"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-2xl text-muted hover:bg-raised hover:text-text"
        >
          ×
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
