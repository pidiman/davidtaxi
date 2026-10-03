import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { TaxiIcon, Wordmark } from '../components/Brand';
import { homeFor, useAuth } from '../lib/auth';

export function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(username, password);
      nav(homeFor(u), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <form
        onSubmit={submit}
        className="card flex w-full max-w-sm flex-col gap-4 border-t-[3px] border-taxi p-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-taxi">
            <TaxiIcon />
          </div>
          <div>
            <Wordmark size={28} />
            <div className="text-xs uppercase tracking-[2px] text-muted">Prihlásenie</div>
          </div>
        </div>
        <label className="label">
          Používateľské meno
          <input
            className="field"
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="label">
          Heslo
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200">{error}</div>}
        <button type="submit" className="btn-primary py-3.5 text-base uppercase" disabled={busy}>
          {busy ? 'Prihlasujem…' : 'Prihlásiť'}
        </button>
      </form>
    </div>
  );
}
