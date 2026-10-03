import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { LogsPanel } from '../components/LogsPanel';
import { Modal } from '../components/Modal';
import { CarPhoto } from '../components/ShiftControls';
import { api, DRIVER_LABEL, ROLE_LABEL, type Role, type User, type Vehicle } from '../lib/api';
import { useAuth } from '../lib/auth';

type Tab = 'drivers' | 'vehicles' | 'staff' | 'logs';
const FUELS = ['benzín', 'nafta', 'LPG', 'CNG', 'hybrid', 'plug-in hybrid', 'elektro'];
const BODIES = ['sedan', 'liftback', 'kombi', 'MPV', 'SUV', 'van'];

// ---------- STK / EK / PZP: platnosť ----------
type Validity = 'ok' | 'soon' | 'expired' | 'none';
function validity(date: string | null): Validity {
  if (!date) return 'none';
  const days = (new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}
const fmtDate = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('sk-SK') : '–');

function ValidityChip({ label, date }: { label: string; date: string | null }) {
  const v = validity(date);
  const cls = {
    ok: 'border-line text-soft',
    soon: 'border-taxi/70 bg-taxi-dim text-taxi',
    expired: 'border-red-400/70 bg-red-950/60 text-red-200',
    none: 'border-line text-muted',
  }[v];
  const suffix = v === 'expired' ? ' · prepadnuté' : v === 'soon' ? ' · končí' : '';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${cls}`}>
      {label} {fmtDate(date)}
      {suffix}
    </span>
  );
}

export function Admin() {
  const { user: me } = useAuth();
  const [tab, setTab] = useState<Tab>('drivers');
  const [users, setUsers] = useState<User[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [editUser, setEditUser] = useState<Partial<User> | null>(null);
  const [editVehicle, setEditVehicle] = useState<Partial<Vehicle> | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const [u, v] = await Promise.all([api<User[]>('/api/users'), api<Vehicle[]>('/api/vehicles')]);
    setUsers(u);
    setVehicles(v);
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg({ text: e.message, error: true }));
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMsg({ text: ok });
      await load();
      return true;
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
      return false;
    }
  }

  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const match = (s: (string | null | undefined)[]) =>
    !q || s.some((x) => x?.toLowerCase().includes(q.toLowerCase()));
  const drivers = users.filter((u) => u.role === 'driver' && match([u.name, u.username, u.phone]));
  const staff = users.filter((u) => u.role !== 'driver' && match([u.name, u.username, u.phone]));
  const cars = vehicles.filter((v) => match([v.callsign, v.plate, v.model, v.color]));
  const expiring = vehicles.filter(
    (v) =>
      v.active &&
      [v.stkUntil, v.ekUntil, v.insuranceUntil].some((d) => ['soon', 'expired'].includes(validity(d))),
  );

  const deleteUser = (u: User) =>
    confirm(`Natrvalo zmazať ${u.name}?`) &&
    run(() => api(`/api/users/${u.id}`, { method: 'DELETE' }), 'Zmazané');
  const deleteVehicle = (v: Vehicle) =>
    confirm(`Natrvalo zmazať auto ${v.callsign} (${v.plate})?`) &&
    run(() => api(`/api/vehicles/${v.id}`, { method: 'DELETE' }), 'Auto zmazané');

  const tabBtn = (t: Tab, label: string, n?: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      className={`rounded-lg px-4 py-2.5 font-semibold ${tab === t ? 'bg-taxi text-black' : 'text-soft hover:bg-raised'}`}
    >
      {label} {n !== undefined && <span className={tab === t ? 'text-black/60' : 'text-muted'}>{n}</span>}
    </button>
  );

  return (
    <div className="min-h-screen bg-ink">
      <Header />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" className="flex flex-wrap gap-1.5 rounded-xl bg-panel p-1.5">
            {tabBtn('drivers', 'Vodiči', users.filter((u) => u.role === 'driver').length)}
            {tabBtn('vehicles', 'Autá', vehicles.length)}
            {tabBtn('staff', 'Dispečeri a admini', users.filter((u) => u.role !== 'driver').length)}
            {tabBtn('logs', 'Logy')}
          </div>
          <div className={`flex flex-wrap gap-2 ${tab === 'logs' ? 'hidden' : ''}`}>
            <input
              className="field w-56"
              placeholder="Hľadať…"
              aria-label="Hľadať"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {tab === 'vehicles' ? (
              <button type="button" className="btn-primary" onClick={() => setEditVehicle({ seats: 4 })}>
                + Nové auto
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  setEditUser({ role: tab === 'drivers' ? 'driver' : 'dispatcher', active: true })
                }
              >
                + {tab === 'drivers' ? 'Nový vodič' : 'Nový dispečer'}
              </button>
            )}
          </div>
        </div>

        {msg && (
          <button
            type="button"
            onClick={() => setMsg(null)}
            className={`rounded-xl px-4 py-3 text-left text-sm ${msg.error ? 'bg-red-950/70 text-red-100' : 'bg-taxi-dim text-[#f2e3b0]'}`}
          >
            {msg.text}
          </button>
        )}

        {expiring.length > 0 && (tab === 'drivers' || tab === 'vehicles') && (
          <div className="rounded-xl border border-taxi/50 bg-taxi-dim px-4 py-3 text-sm text-[#f2e3b0]">
            Pozor – STK, EK alebo PZP končí do 30 dní alebo už prepadlo:{' '}
            {expiring.map((v) => `${v.callsign} (${v.plate})`).join(', ')}
          </div>
        )}

        {/* ---------------- VODIČI ---------------- */}
        {tab === 'drivers' && (
          <section className="card overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-2.5 py-2">Meno</th>
                  <th className="px-2.5 py-2">Login</th>
                  <th className="px-2.5 py-2">Telefón</th>
                  <th className="px-2.5 py-2">V aute (smena)</th>
                  <th className="px-2.5 py-2">Teraz</th>
                  <th className="px-2.5 py-2 text-right">Jazdy</th>
                  <th className="px-2.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {drivers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2.5 py-4 text-muted">
                      Žiadni vodiči.
                    </td>
                  </tr>
                )}
                {drivers.map((u) => {
                  const v = u.vehicleId ? vehicleById.get(u.vehicleId) : undefined;
                  return (
                    <tr key={u.id} className={`border-t border-[#2a2a2a] ${u.active ? '' : 'opacity-50'}`}>
                      <td className="px-2.5 py-2.5">
                        <div className="font-semibold">{u.name}</div>
                        {!u.active && <div className="text-xs text-muted">deaktivovaný</div>}
                      </td>
                      <td className="px-2.5 py-2.5 text-soft">{u.username}</td>
                      <td className="px-2.5 py-2.5 text-soft">{u.phone ?? '–'}</td>
                      <td className="px-2.5 py-2.5">
                        {v ? (
                          <span>
                            <b>{v.callsign}</b> <span className="text-muted">· {v.plate}</span>
                          </span>
                        ) : (
                          <span className="text-muted">mimo smeny</span>
                        )}
                      </td>
                      <td className="px-2.5 py-2.5">{DRIVER_LABEL[u.driverStatus]}</td>
                      <td className="px-2.5 py-2.5 text-right tabular-nums">{u.rideCount ?? 0}</td>
                      <RowActions
                        onEdit={() => setEditUser(u)}
                        toggleLabel={u.active ? 'Deaktivovať' : 'Aktivovať'}
                        onToggle={() =>
                          run(
                            () => api(`/api/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }),
                            u.active ? 'Vodič deaktivovaný' : 'Vodič aktivovaný',
                          )
                        }
                        onDelete={() => deleteUser(u)}
                        canDelete={(u.rideCount ?? 0) === 0}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {/* ---------------- AUTÁ ---------------- */}
        {tab === 'vehicles' && (
          <section className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
            {cars.length === 0 && <p className="text-muted">Žiadne autá.</p>}
            {cars.map((v) => {
              const assigned = users.filter((u) => u.vehicleId === v.id);
              return (
                <article key={v.id} className={`card flex flex-col gap-3 ${v.active ? '' : 'opacity-50'}`}>
                  <CarPhoto url={v.photoUrl} callsign={v.callsign} />
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-taxi text-lg font-extrabold text-black">
                      {v.callsign}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-xl font-bold leading-tight">{v.model}</div>
                      <div className="text-sm text-soft">
                        {v.plate}
                        {!v.active && ' · vyradené'}
                      </div>
                    </div>
                  </div>
                  <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <Spec k="Farba" v={v.color} />
                    <Spec k="Rok" v={v.year} />
                    <Spec k="Karoséria" v={v.bodyType} />
                    <Spec k="Palivo" v={v.fuel} />
                    <Spec k="Miesta" v={v.seats} />
                    <Spec k="Jazdy" v={v.rideCount ?? 0} />
                  </dl>
                  <div className="flex flex-wrap gap-1.5">
                    <ValidityChip label="STK" date={v.stkUntil} />
                    <ValidityChip label="EK" date={v.ekUntil} />
                    <ValidityChip label="PZP" date={v.insuranceUntil} />
                  </div>
                  <div className="text-sm text-muted">
                    Teraz jazdí: {assigned.length ? assigned.map((u) => u.name).join(', ') : 'nikto'}
                  </div>
                  {v.note && <div className="rounded-lg bg-ink px-3 py-2 text-sm text-soft">{v.note}</div>}
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
                    <button
                      type="button"
                      className="btn-outline px-3 py-1.5 text-sm"
                      onClick={() => setEditVehicle(v)}
                    >
                      Upraviť
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-3 py-1.5 text-sm"
                      onClick={() =>
                        run(
                          () =>
                            api(`/api/vehicles/${v.id}`, { method: 'PATCH', body: { active: !v.active } }),
                          v.active ? 'Auto vyradené' : 'Auto znova v prevádzke',
                        )
                      }
                    >
                      {v.active ? 'Vyradiť' : 'Vrátiť do prevádzky'}
                    </button>
                    {(v.rideCount ?? 0) === 0 && (v.shiftCount ?? 0) === 0 && (
                      <button
                        type="button"
                        className="ml-auto px-2 py-1.5 text-sm text-red-300 hover:text-red-200"
                        onClick={() => deleteVehicle(v)}
                      >
                        Zmazať
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {/* ---------------- DISPEČERI A ADMINI ---------------- */}
        {tab === 'staff' && (
          <section className="card overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-2.5 py-2">Meno</th>
                  <th className="px-2.5 py-2">Login</th>
                  <th className="px-2.5 py-2">Rola</th>
                  <th className="px-2.5 py-2">Telefón</th>
                  <th className="px-2.5 py-2">E-mail</th>
                  <th className="px-2.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {staff.map((u) => (
                  <tr key={u.id} className={`border-t border-[#2a2a2a] ${u.active ? '' : 'opacity-50'}`}>
                    <td className="px-2.5 py-2.5 font-semibold">
                      {u.name} {u.id === me?.id && <span className="text-xs text-taxi">(ty)</span>}
                    </td>
                    <td className="px-2.5 py-2.5 text-soft">{u.username}</td>
                    <td className="px-2.5 py-2.5">{ROLE_LABEL[u.role]}</td>
                    <td className="px-2.5 py-2.5 text-soft">{u.phone ?? '–'}</td>
                    <td className="px-2.5 py-2.5 text-soft">{u.email ?? '–'}</td>
                    {u.id === me?.id ? (
                      <td className="px-2.5 py-2.5 text-right">
                        <button type="button" className="text-sm text-taxi" onClick={() => setEditUser(u)}>
                          Upraviť
                        </button>
                      </td>
                    ) : (
                      <RowActions
                        onEdit={() => setEditUser(u)}
                        toggleLabel={u.active ? 'Deaktivovať' : 'Aktivovať'}
                        onToggle={() =>
                          run(
                            () => api(`/api/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }),
                            'Uložené',
                          )
                        }
                        onDelete={() => deleteUser(u)}
                        canDelete
                      />
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === 'logs' && <LogsPanel />}
      </main>

      {editUser && (
        <UserForm
          initial={editUser}
          isSelf={editUser.id === me?.id}
          onClose={() => setEditUser(null)}
          onSave={async (body) => {
            const ok = await run(
              () =>
                editUser.id
                  ? api(`/api/users/${editUser.id}`, { method: 'PATCH', body })
                  : api('/api/users', { body }),
              editUser.id ? 'Uložené' : 'Používateľ vytvorený',
            );
            if (ok) setEditUser(null);
          }}
        />
      )}
      {editVehicle && (
        <VehicleForm
          initial={editVehicle}
          onClose={() => setEditVehicle(null)}
          onSave={async (body, photo) => {
            const ok = await run(
              async () => {
                const saved = editVehicle.id
                  ? await api<Vehicle>(`/api/vehicles/${editVehicle.id}`, { method: 'PATCH', body })
                  : await api<Vehicle>('/api/vehicles', { body });
                if (photo === 'remove') await api(`/api/vehicles/${saved.id}/photo`, { method: 'DELETE' });
                else if (photo)
                  await api(`/api/vehicles/${saved.id}/photo`, { method: 'PUT', body: { dataUrl: photo } });
              },
              editVehicle.id ? 'Auto uložené' : 'Auto pridané',
            );
            if (ok) setEditVehicle(null);
          }}
        />
      )}
    </div>
  );
}

function Spec({ k, v }: { k: string; v: string | number | null }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="m-0 text-right">{v ?? '–'}</dd>
    </>
  );
}

function RowActions({
  onEdit,
  onToggle,
  toggleLabel,
  onDelete,
  canDelete,
}: {
  onEdit: () => void;
  onToggle: () => void;
  toggleLabel: string;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <td className="px-2.5 py-2.5 whitespace-nowrap text-right">
      <button type="button" className="mr-3 text-sm text-taxi hover:text-taxi-hover" onClick={onEdit}>
        Upraviť
      </button>
      <button type="button" className="mr-3 text-sm text-muted hover:text-text" onClick={onToggle}>
        {toggleLabel}
      </button>
      {canDelete ? (
        <button type="button" className="text-sm text-red-300 hover:text-red-200" onClick={onDelete}>
          Zmazať
        </button>
      ) : (
        <span className="text-xs text-muted" title="Má jazdy v histórii – dá sa len deaktivovať">
          –
        </span>
      )}
    </td>
  );
}

// ---------------- formulár používateľa ----------------
function UserForm({
  initial,
  isSelf,
  onClose,
  onSave,
}: {
  initial: Partial<User>;
  isSelf: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const isNew = !initial.id;
  const [f, setF] = useState({
    role: (initial.role ?? 'driver') as Role,
    name: initial.name ?? '',
    username: initial.username ?? '',
    password: '',
    phone: initial.phone ?? '',
    email: initial.email ?? '',
    note: initial.note ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const body: Record<string, unknown> = {
      role: f.role,
      name: f.name,
      username: f.username,
      phone: f.phone || null,
      email: f.email || null,
      note: f.note || null,
    };
    if (f.password) body.password = f.password;
    if (isSelf) delete body.role;
    await onSave(body);
    setSaving(false);
  }

  const title = isNew ? (f.role === 'driver' ? 'Nový vodič' : 'Nový používateľ') : `Upraviť: ${initial.name}`;

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {!isSelf && (
          <label className="label">
            Rola
            <select className="field" value={f.role} onChange={set('role')}>
              <option value="driver">Vodič</option>
              <option value="dispatcher">Dispečer</option>
              <option value="admin">Admin</option>
              <option value="owner">Majiteľ</option>
            </select>
          </label>
        )}
        {f.role === 'owner' && (
          <p className="m-0 rounded-[10px] bg-ink p-3 text-[13px] leading-snug text-muted">
            Majiteľ má rovnaké práva ako admin. Na jeho e-mail budú neskôr chodiť prevádzkové info (prehľady,
            upozornenia) – vyplň ho.
          </p>
        )}
        <label className="label">
          Meno a priezvisko
          <input className="field" required value={f.name} onChange={set('name')} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="label">
            Login
            <input
              className="field"
              required
              autoCapitalize="none"
              value={f.username}
              onChange={set('username')}
            />
          </label>
          <label className="label">
            {isNew ? 'Heslo' : 'Nové heslo (prázdne = nemeniť)'}
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required={isNew}
              value={f.password}
              onChange={set('password')}
            />
          </label>
          <label className="label">
            Telefón
            <input className="field" type="tel" value={f.phone} onChange={set('phone')} />
          </label>
          <label className="label">
            E-mail{f.role === 'owner' ? ' (sem chodia prehľady)' : ''}
            <input
              className="field"
              type="email"
              required={f.role === 'owner'}
              value={f.email}
              onChange={set('email')}
            />
          </label>
        </div>
        <label className="label">
          Poznámka
          <textarea className="field resize-y" rows={2} value={f.note} onChange={set('note')} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Zrušiť
          </button>
          <button type="submit" className="btn-primary px-6" disabled={saving}>
            {isNew ? 'Vytvoriť' : 'Uložiť'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- formulár auta ----------------
function VehicleForm({
  initial,
  onClose,
  onSave,
}: {
  initial: Partial<Vehicle>;
  onClose: () => void;
  onSave: (body: Record<string, unknown>, photo: string | 'remove' | null) => Promise<void>;
}) {
  const isNew = !initial.id;
  const [photo, setPhoto] = useState<string | 'remove' | null>(null);
  const [photoErr, setPhotoErr] = useState('');
  const preview = photo === 'remove' ? null : (photo ?? initial.photoUrl ?? null);
  const s = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const [f, setF] = useState({
    callsign: s(initial.callsign),
    plate: s(initial.plate),
    model: s(initial.model),
    color: s(initial.color),
    year: s(initial.year),
    seats: s(initial.seats ?? 4),
    bodyType: s(initial.bodyType),
    fuel: s(initial.fuel),
    vin: s(initial.vin),
    stkUntil: s(initial.stkUntil),
    ekUntil: s(initial.ekUntil),
    insuranceUntil: s(initial.insuranceUntil),
    note: s(initial.note),
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) body[k] = v === '' ? null : v;
    body.year = f.year ? Number(f.year) : null;
    body.seats = f.seats ? Number(f.seats) : 4;
    await onSave(body, photo);
    setSaving(false);
  }

  return (
    <Modal title={isNew ? 'Nové auto' : `Upraviť auto ${initial.callsign}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <div className="w-40 shrink-0">
            <CarPhoto url={preview} callsign={f.callsign || '?'} />
          </div>
          <div className="flex flex-col items-start gap-2 text-sm">
            <label className="btn-outline cursor-pointer px-3 py-2">
              {preview ? 'Zmeniť fotku' : 'Nahrať fotku'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setPhotoErr('');
                  try {
                    setPhoto(await resizeImage(file));
                  } catch {
                    setPhotoErr('Fotku sa nepodarilo načítať');
                  }
                }}
              />
            </label>
            {preview && (
              <button
                type="button"
                className="text-red-300 hover:text-red-200"
                onClick={() => setPhoto('remove')}
              >
                Odstrániť fotku
              </button>
            )}
            {photoErr && <span className="text-red-300">{photoErr}</span>}
            <span className="text-xs text-muted">Zmenší sa automaticky na max. 1280 px.</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="label">
            Číslo auta
            <input
              className="field"
              required
              placeholder="07"
              value={f.callsign}
              onChange={set('callsign')}
            />
          </label>
          <label className="label col-span-1 sm:col-span-1">
            ŠPZ
            <input
              className="field uppercase"
              required
              placeholder="BA123XY"
              value={f.plate}
              onChange={set('plate')}
            />
          </label>
          <label className="label col-span-2">
            Značka a model
            <input
              className="field"
              required
              placeholder="Škoda Superb"
              value={f.model}
              onChange={set('model')}
            />
          </label>
          <label className="label">
            Farba
            <input className="field" placeholder="čierna" value={f.color} onChange={set('color')} />
          </label>
          <label className="label">
            Rok výroby
            <input
              className="field"
              type="number"
              min={1980}
              max={2100}
              value={f.year}
              onChange={set('year')}
            />
          </label>
          <label className="label">
            Miesta pre cestujúcich
            <input className="field" type="number" min={1} max={20} value={f.seats} onChange={set('seats')} />
          </label>
          <label className="label">
            Karoséria
            <select className="field" value={f.bodyType} onChange={set('bodyType')}>
              <option value="">—</option>
              {BODIES.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="label">
            Palivo
            <select className="field" value={f.fuel} onChange={set('fuel')}>
              <option value="">—</option>
              {FUELS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="label col-span-2 sm:col-span-3">
            VIN
            <input className="field uppercase" maxLength={17} value={f.vin} onChange={set('vin')} />
          </label>
        </div>
        <fieldset className="m-0 grid grid-cols-1 gap-3 rounded-xl border border-line p-3 sm:grid-cols-3">
          <legend className="px-1 text-xs uppercase tracking-wider text-muted">Platnosť dokladov</legend>
          <label className="label">
            STK do
            <input className="field" type="date" value={f.stkUntil} onChange={set('stkUntil')} />
          </label>
          <label className="label">
            EK do
            <input className="field" type="date" value={f.ekUntil} onChange={set('ekUntil')} />
          </label>
          <label className="label">
            PZP do
            <input className="field" type="date" value={f.insuranceUntil} onChange={set('insuranceUntil')} />
          </label>
        </fieldset>
        <label className="label">
          Poznámka
          <textarea className="field resize-y" rows={2} value={f.note} onChange={set('note')} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Zrušiť
          </button>
          <button type="submit" className="btn-primary px-6" disabled={saving}>
            {isNew ? 'Pridať auto' : 'Uložiť'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Zmenší fotku v prehliadači (max 1280 px, JPEG 82 %) – do DB ide ~150–300 kB. */
async function resizeImage(file: File, max = 1280): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}
