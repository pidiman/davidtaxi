import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AddressInput } from './AddressInput';
import { MapPicker } from './MapPicker';
import { Modal } from './Modal';

export type Destination = { dropoffAddress: string; dropoffLat: number | null; dropoffLng: number | null };
type Pt = { lat: number; lng: number };

/**
 * Výber cieľa B pre jazdu bez cieľa – pri ukončení jazdy alebo dodatočne:
 * aktuálna GPS adresa (zobrazená), výber na mape, ručné napísanie, prípadne „doplním neskôr“.
 */
export function DestinationChooser({
  mode,
  pos,
  busy,
  onConfirm,
  onLater,
  onClose,
}: {
  mode: 'finish' | 'fill';
  pos: Pt | null;
  busy?: boolean;
  onConfirm: (d: Destination) => void;
  onLater?: () => void;
  onClose: () => void;
}) {
  const [gps, setGps] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [gpsState, setGpsState] = useState<'loading' | 'ok' | 'none'>(pos ? 'loading' : 'none');
  const [map, setMap] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState<{ address: string; lat: number | null; lng: number | null }>({
    address: '',
    lat: null,
    lng: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: adresa sa zistí raz pri otvorení
  useEffect(() => {
    if (!pos) return;
    api<{ label: string }>(`/api/geocode/reverse?lat=${pos.lat}&lng=${pos.lng}`)
      .then((r) => {
        setGps({ label: r.label, lat: pos.lat, lng: pos.lng });
        setGpsState('ok');
      })
      .catch(() => {
        setGps({ label: `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`, lat: pos.lat, lng: pos.lng });
        setGpsState('ok');
      });
  }, []);

  if (map) {
    return (
      <MapPicker
        title="Cieľ jazdy"
        letter="B"
        initial={null}
        me={pos}
        onPick={(p) => onConfirm({ dropoffAddress: p.address, dropoffLat: p.lat, dropoffLng: p.lng })}
        onClose={() => setMap(false)}
      />
    );
  }

  const option =
    'flex w-full items-center gap-3 rounded-2xl border border-line p-4 text-left disabled:opacity-40';

  return (
    <Modal title={mode === 'finish' ? 'Kam ste prišli?' : 'Doplniť cieľ'} onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        <p className="m-0 text-sm text-muted">
          Jazda nemá cieľ (B). {mode === 'finish' ? 'Vyber, ako ho zapísať:' : 'Zapíš ho jedným zo spôsobov:'}
        </p>

        {/* 1) aktuálna GPS poloha */}
        <button
          type="button"
          className={`${option} border-2 border-taxi bg-taxi-dim`}
          disabled={busy || gpsState !== 'ok'}
          onClick={() =>
            gps && onConfirm({ dropoffAddress: gps.label, dropoffLat: gps.lat, dropoffLng: gps.lng })
          }
        >
          <span className="text-2xl" aria-hidden="true">
            ⌖
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">Aktuálna poloha (GPS)</span>
            <span className="block text-sm text-soft">
              {gpsState === 'loading'
                ? 'zisťujem adresu…'
                : gpsState === 'none'
                  ? 'poloha nie je k dispozícii'
                  : gps?.label}
            </span>
          </span>
        </button>

        {/* 2) mapa */}
        <button type="button" className={option} disabled={busy} onClick={() => setMap(true)}>
          <span className="text-2xl" aria-hidden="true">
            🗺
          </span>
          <span className="flex-1">
            <span className="block font-bold">Nájsť na mape</span>
            <span className="block text-sm text-muted">ťukni na miesto, kde zákazník vystúpil</span>
          </span>
        </button>

        {/* 3) ručne */}
        {typing ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-line p-3">
            <AddressInput label="Adresa cieľa" value={typed.address} onChange={setTyped} />
            <button
              type="button"
              className="btn-primary h-12 rounded-xl"
              disabled={busy || typed.address.trim().length < 3}
              onClick={() =>
                onConfirm({
                  dropoffAddress: typed.address.trim(),
                  dropoffLat: typed.lat,
                  dropoffLng: typed.lng,
                })
              }
            >
              Použiť túto adresu
            </button>
          </div>
        ) : (
          <button type="button" className={option} disabled={busy} onClick={() => setTyping(true)}>
            <span className="text-2xl" aria-hidden="true">
              ✎
            </span>
            <span className="flex-1">
              <span className="block font-bold">Napísať adresu</span>
              <span className="block text-sm text-muted">s našepkávaním</span>
            </span>
          </button>
        )}

        {/* 4) neskôr – vodič musí rýchlo odísť */}
        {onLater && (
          <button
            type="button"
            className="mt-1 rounded-2xl p-3 text-center text-sm font-semibold text-taxi disabled:opacity-40"
            disabled={busy}
            onClick={onLater}
          >
            Ukončiť teraz, cieľ doplním neskôr (Moje jazdy)
          </button>
        )}
      </div>
    </Modal>
  );
}
