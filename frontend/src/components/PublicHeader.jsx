import { useEffect, useRef, useState } from 'react';
import { Brand } from './Brand';
import { Icon } from './Icon';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Link, useRouter } from '../lib/router';
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
      {user ? (primary ? 'Open workspace' : 'View history') : primary ? 'Try Data Genie' : 'Log in'}
    </Link>
  );
}
function NavigationLinks({ faq, contact, onClick }) {
  return (
    <>
      <Link href="/#how" onClick={onClick}>
        How it works
      </Link>
      <Link href="/#ask" onClick={onClick}>
        What you can ask
      </Link>
      <Link href="/#safety" onClick={onClick}>
        Safety
      </Link>
      <Link href="/faq" aria-current={faq ? 'page' : undefined} onClick={onClick}>
        FAQ
      </Link>
      <Link href="/contact" aria-current={contact ? 'page' : undefined} onClick={onClick}>
        Contact us
      </Link>
    </>
  );
}
export function PublicHeader({ faq = false, contact = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { route } = useRouter();
  const header = useRef(null),
    menuButton = useRef(null);
  useEffect(() => {
    setMenuOpen(false);
  }, [route]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event) => {
      if (!header.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);
  return (
    <header
      className="top"
      ref={header}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) {
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <div className="wrap bar">
        <Brand />
        <nav className="nav" aria-label="Main navigation">
          <NavigationLinks faq={faq} contact={contact} />
        </nav>
        <div className="actions">
          {!menuOpen && <ThemeToggle />}
          <EntryLink className={'btn ' + (faq ? 'quiet' : 'btn-quiet btn-sm signin')} />
          <EntryLink primary className={'btn ' + (faq ? 'primary' : 'btn-primary btn-sm')} />
          <button
            ref={menuButton}
            className="icon-btn public-menu-toggle"
            type="button"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            aria-controls="public-mobile-nav"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Icon name={menuOpen ? 'x' : 'menu'} />
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="public-mobile-nav" className="public-mobile-nav" aria-label="Mobile navigation">
          <NavigationLinks faq={faq} contact={contact} onClick={() => setMenuOpen(false)} />
          <div className="mobile-nav-actions">
            <EntryLink className="btn btn-secondary" />
            <ThemeToggle />
          </div>
        </nav>
      )}
    </header>
  );
}
