import { Brand } from './Brand';
import { Icon } from './Icon';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Link } from '../lib/router';
export function ThemeToggle({ className = 'icon-btn' }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      className={className}
      type="button"
      onClick={toggle}
      aria-label={'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
export function EntryLink({ primary = false, className = '' }) {
  const { user } = useAuth();
  return (
    <Link
      className={className}
      data-entry={primary ? 'signup' : 'login'}
      href={user ? (primary ? '/app' : '/history') : primary ? '/signup' : '/signin'}
    >
      {user ? (primary ? 'Open workspace' : 'View history') : primary ? 'Sign up' : 'Log in'}
    </Link>
  );
}
export function PublicHeader({ faq = false }) {
  return (
    <header className="top">
      <div className="wrap bar">
        <Brand />
        <nav className="nav" aria-label="Main navigation">
          <Link href="/#how">How it works</Link>
          <Link href="/#ask">What you can ask</Link>
          <Link href="/#safety">Safety</Link>
          <Link href="/faq" aria-current={faq ? 'page' : undefined}>
            FAQ
          </Link>
        </nav>
        <div className="actions">
          <ThemeToggle />
          <EntryLink className={'btn ' + (faq ? 'quiet' : 'btn-quiet btn-sm signin')} />
          <EntryLink primary className={'btn ' + (faq ? 'primary' : 'btn-primary btn-sm')} />
        </div>
      </div>
    </header>
  );
}
