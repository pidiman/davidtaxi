import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { api, type Role, type User, type Vehicle } from '../lib/api';
import { useAuth } from '../lib/auth';

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', dispatcher: 'Dispečer', driver: 'Vodič' };

export function Admin() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [msg, setMsg] = useState('');
  const [uf, setUf] = useState({
    name: '',
    username: '',
    password: '',
    phone: '',
    role: 'driver' as Role,
    vehicleId: '',
  });
  const [vf, setVf] = useState({ callsign: '', plate: '', model: '' });

  const load = useCallback(async () => {
    const [u, v] = await Promise.all([api<User[]>('/api/users'), api<Vehicle[]>('/api/vehicles')]);
    setUsers(u);
    setVehicles(v);
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  function createUser(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await api('/api/users', {
        body: { ...uf, vehicleId: uf.vehicleId ? Number(uf.vehicleId) : undefined },
      });
      setUf({ name: '', username: '', password: '', phone: '', role: uf.role, vehicleId: '' });
    }, 'Používateľ vytvorený');
  }

  function createVehicle(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await api('/api/vehicles', { body: vf });
      setVf({ callsign: '', plate: '', model: '' });
    }, 'Auto pridané');
  }

  const patchUser = (id: number, body: Record<string, unknown>, ok = 'Uložené') =>
    run(() => api(`/api/users/${id}`, { method: 'PATCH', body }), ok);

  return (
    <div className="min-h-screen bg-ink">
      <Header />
      <main className="mx-auto flex max-w-[1400px] flex-wrap items-start gap-4 p-6">
        {msg && (
          <button
            type="button"
            onClick={() => setMsg('')}
            className="w-full rounded-xl bg-taxi-dim px-4 py-3 text-left text-sm text-[#f2e3b0]"
          >
            {msg}
          </button>
        )}

        <section className="card flex min-w-0 flex-[999_1_640px] flex-col gap-3">
          <h2 className="h2">Používatelia</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-2.5 py-2">Meno</th>
                  <th className="px-2.5 py-2">Login</th>
                  <th className="px-2.5 py-2">Rola</th>
                  <th className="px-2.5 py-2">Telefón</th>
                  <th className="px-2.5 py-2">Auto</th>
                  <th className="px-2.5 py-2">Stav</th>
                  <th className="px-2.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={`border-t border-[#2a2a2a] ${u.active ? '' : 'opacity-50'}`}>
                    <td className="px-2.5 py-2.5 font-semibold">{u.name}</td>
                    <td className="px-2.5 py-2.5 text-soft">{u.username}</td>
                    <td className="px-2.5 py-2.5">{ROLE_LABEL[u.role]}</td>
                    <td className="px-2.5 py-2.5 text-soft">{u.phone ?? '–'}</td>
                    <td className="px-2.5 py-2.5">
                      {u.role === 'driver' ? (
                        <select
                          aria-label={`Auto pre ${u.name}`}
                          className="field py-1.5"
                          value={u.vehicleId ?? ''}
                          onChange={(e) =>
                            patchUser(u.id, { vehicleId: e.target.value ? Number(e.target.value) : null })
                          }
                        >
                          <option value="">— bez auta —</option>
                          {vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.callsign} · {v.plate}
                            </option>
                          ))}
                        </select>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="px-2.5 py-2.5">{u.active ? 'aktívny' : 'deaktivovaný'}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap text-right">
                      <button
                        type="button"
                        className="mr-3 text-xs text-muted hover:text-text"
                        onClick={() => {
                          const p = prompt(`Nové heslo pre ${u.name} (min. 8 znakov):`);
                          if (p) patchUser(u.id, { password: p }, 'Heslo zmenené');
                        }}
                      >
                        Heslo
                      </button>
                      {u.id !== me?.id && (
                        <button
                          type="button"
                          className="text-xs text-muted hover:text-text"
                          onClick={() => patchUser(u.id, { active: !u.active })}
                        >
                          {u.active ? 'Deaktivovať' : 'Aktivovať'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="flex min-w-0 max-w-[420px] flex-[1_1_320px] flex-col gap-4">
          <form onSubmit={createUser} className="card flex flex-col gap-3">
            <h2 className="h2">Nový používateľ</h2>
            <label className="label">
              Rola
              <select
                className="field"
                value={uf.role}
                onChange={(e) => setUf({ ...uf, role: e.target.value as Role })}
              >
                <option value="driver">Vodič</option>
                <option value="dispatcher">Dispečer</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="label">
              Meno a priezvisko
              <input
                className="field"
                required
                value={uf.name}
                onChange={(e) => setUf({ ...uf, name: e.target.value })}
              />
            </label>
            <div className="flex gap-2.5">
              <label className="label flex-1">
                Login
                <input
                  className="field"
                  required
                  autoCapitalize="none"
                  value={uf.username}
                  onChange={(e) => setUf({ ...uf, username: e.target.value })}
                />
              </label>
              <label className="label flex-1">
                Heslo
                <input
                  className="field"
                  required
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  value={uf.password}
                  onChange={(e) => setUf({ ...uf, password: e.target.value })}
                />
              </label>
            </div>
            <label className="label">
              Telefón
              <input
                className="field"
                type="tel"
                value={uf.phone}
                onChange={(e) => setUf({ ...uf, phone: e.target.value })}
              />
            </label>
            {uf.role === 'driver' && (
              <label className="label">
                Auto
                <select
                  className="field"
                  value={uf.vehicleId}
                  onChange={(e) => setUf({ ...uf, vehicleId: e.target.value })}
                >
                  <option value="">— bez auta —</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.callsign} · {v.model} · {v.plate}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="submit" className="btn-primary py-3 uppercase">
              Vytvoriť
            </button>
          </form>

          <div className="card flex flex-col gap-3">
            <h2 className="h2">Autá</h2>
            {vehicles.length === 0 && <p className="m-0 text-sm text-muted">Zatiaľ žiadne autá.</p>}
            {vehicles.map((v) => (
              <div key={v.id} className="flex items-center gap-3 border-t border-line pt-2.5 text-sm">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-taxi font-extrabold text-black">
                  {v.callsign}
                </div>
                <div className="flex-1">
                  <div className="font-semibold">{v.model}</div>
                  <div className="text-muted">{v.plate}</div>
                </div>
              </div>
            ))}
            <form onSubmit={createVehicle} className="flex flex-col gap-2.5 border-t border-line pt-3">
              <div className="flex gap-2.5">
                <label className="label w-20">
                  Číslo
                  <input
                    className="field"
                    required
                    placeholder="07"
                    value={vf.callsign}
                    onChange={(e) => setVf({ ...vf, callsign: e.target.value })}
                  />
                </label>
                <label className="label flex-1">
                  ŠPZ
                  <input
                    className="field"
                    required
                    placeholder="BA123XY"
                    value={vf.plate}
                    onChange={(e) => setVf({ ...vf, plate: e.target.value })}
                  />
                </label>
              </div>
              <label className="label">
                Model
                <input
                  className="field"
                  required
                  placeholder="Škoda Superb"
                  value={vf.model}
                  onChange={(e) => setVf({ ...vf, model: e.target.value })}
                />
              </label>
              <button type="submit" className="btn-outline">
                Pridať auto
              </button>
            </form>
          </div>
        </aside>
      </main>
    </div>
  );
}
