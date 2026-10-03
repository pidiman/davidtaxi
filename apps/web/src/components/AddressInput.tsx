import { useEffect, useRef, useState } from 'react';
import { api, type GeoResult } from '../lib/api';

/**
 * Textové pole adresy s našepkávaním cez /api/geocode. Súradnice sú voliteľné.
 * Ikona na konci poľa prepne mapu do režimu výberu bodu (onPickMap).
 */
export function AddressInput({
  label,
  value,
  onChange,
  onPickMap,
  picking = false,
  pinLabel,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (v: { address: string; lat: number | null; lng: number | null }) => void;
  onPickMap?: () => void;
  picking?: boolean;
  pinLabel?: string;
  required?: boolean;
}) {
  const [items, setItems] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current || value.trim().length < 4) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      api<GeoResult[]>(`/api/geocode?q=${encodeURIComponent(value)}`)
        .then((r) => {
          setItems(r);
          setOpen(true);
        })
        .catch(() => setItems([]));
    }, 600);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div className="relative">
      <label className="label">
        {label}
        <div className="relative">
          <input
            className={`field ${onPickMap ? 'pr-12' : ''} ${picking ? 'border-taxi' : ''}`}
            value={value}
            required={required}
            placeholder={picking ? 'Klikni na mapu…' : undefined}
            onChange={(e) => {
              typed.current = true;
              onChange({ address: e.target.value, lat: null, lng: null });
            }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onFocus={() => items.length && setOpen(true)}
          />
          {onPickMap && (
            <button
              type="button"
              onClick={onPickMap}
              aria-pressed={picking}
              aria-label={`${pinLabel ?? label}: vybrať na mape`}
              title="Vybrať bod kliknutím na mapu"
              className={`absolute top-1/2 right-1 flex h-9 w-10 -translate-y-1/2 items-center justify-center rounded-md ${
                picking ? 'bg-taxi text-black' : 'text-muted hover:bg-raised hover:text-taxi'
              }`}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </button>
          )}
        </div>
      </label>
      {open && items.length > 0 && (
        <ul className="absolute z-[1000] mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-raised p-1 shadow-xl">
          {items.map((it) => (
            <li key={`${it.lat},${it.lng}`}>
              <button
                type="button"
                className="w-full rounded-md px-3 py-2 text-left text-sm text-soft hover:bg-ink"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  typed.current = false;
                  const short = it.label.split(',').slice(0, 3).join(',');
                  onChange({ address: short, lat: it.lat, lng: it.lng });
                  setOpen(false);
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
