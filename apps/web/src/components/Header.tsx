import { NavLink } from 'react-router';
import { isAdmin, ROLE_LABEL } from '../lib/api';
import { useAuth } from '../lib/auth';
import { TaxiIcon, Wordmark } from './Brand';

export function Header({ connected }: { connected?: boolean }) {
  const { user, logout } = useAuth();
  if (!user) return null;
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-4 py-2.5 font-semibold no-underline ${isActive ? 'bg-raised text-taxi' : 'text-soft hover:text-text'}`;
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b-[3px] border-taxi bg-black px-6 py-3">
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-taxi">
          <TaxiIcon />
        </div>
        <div>
          <Wordmark />
          <div className="text-xs uppercase tracking-[2px] text-muted">Dispečing</div>
        </div>
      </div>
      <nav className="flex flex-wrap gap-1.5">
        <NavLink to="/dispatch" className={link}>
          Dashboard
        </NavLink>
        <NavLink to="/schedule" className={link}>
          Rozpis
        </NavLink>
        <NavLink to="/history" className={link}>
          História jázd
        </NavLink>
        {isAdmin(user.role) && (
          <NavLink to="/admin" className={link}>
            Admin
          </NavLink>
        )}
      </nav>
      <div className="flex items-center gap-4">
        {connected !== undefined && (
          <span
            className={`rounded-full border px-2.5 py-1 text-xs ${connected ? 'border-taxi/50 text-taxi' : 'border-line text-muted'}`}
          >
            {connected ? '● živé spojenie' : '○ odpojené'}
          </span>
        )}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-raised font-bold text-taxi">
            {initials}
          </div>
          <div className="leading-tight">
            <div className="font-semibold">{user.name}</div>
            <div className="text-xs text-muted">{ROLE_LABEL[user.role]}</div>
          </div>
        </div>
        <button type="button" onClick={logout} className="btn-ghost px-3 py-2 text-sm">
          Odhlásiť
        </button>
      </div>
    </header>
  );
}
