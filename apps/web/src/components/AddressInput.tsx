import { useEffect, useRef, useState } from 'react';
import { api, type GeoResult } from '../lib/api';

/** Textové pole adresy s našepkávaním cez /api/geocode. Súradnice sú voliteľné. */
export function AddressInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: { address: string; lat: number | null; lng: number | null }) => void;
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
        <input
          className="field"
          value={value}
          required
          onChange={(e) => {
            typed.current = true;
            onChange({ address: e.target.value, lat: null, lng: null });
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => items.length && setOpen(true)}
        />
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
