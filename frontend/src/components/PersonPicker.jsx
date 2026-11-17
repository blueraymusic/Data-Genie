import { useEffect, useId, useRef, useState } from 'react';
import { ProfileAvatar } from './ProfileAvatar';
import { Icon } from './Icon';

const nameOf = (person) =>
  [person.first_name, person.last_name].filter(Boolean).join(' ') || person.email;
const roleOf = (person) =>
  ({ owner: 'Owner', member: 'Member', viewer: 'Viewer' })[person.role] || person.role;

export function PersonPicker({ members, selected, disabled, onSelect, onOpenChange }) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const panel = useRef(null),
    trigger = useRef(null),
    searchInput = useRef(null);
  const listId = useId();
  const available = members.filter((person) =>
    `${nameOf(person)} ${person.email} ${roleOf(person)}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(available.length / 4));
  const currentPage = Math.min(page, pages);
  const visible = available.slice((currentPage - 1) * 4, currentPage * 4);
  useEffect(() => {
    setPage((value) => Math.min(value, pages));
    if (open && document.activeElement === document.body) searchInput.current?.focus();
  }, [pages, open]);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  useEffect(() => {
    if (disabled || members.length < 2) setOpen(false);
  }, [disabled, members.length]);
  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const outside = (event) => {
      if (!panel.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function keyboard(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target === searchInput.current && ['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = [...panel.current.querySelectorAll('[role="option"]')];
    if (!options.length) return;
    const index = options.indexOf(document.activeElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % options.length
            : (index - 1 + options.length) % options.length;
    options[next].focus();
  }
  return (
    <div
      ref={panel}
      className="person-picker"
      onKeyDown={keyboard}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span className="person-picker-label">Person</span>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label="Select a person"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        disabled={disabled || members.length < 2}
        className="person-picker-trigger"
        onClick={() => {
          setSearch('');
          setPage(1);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }
        }}
      >
        <ProfileAvatar user={selected} />
        <span className="person-picker-identity">
          <strong title={nameOf(selected)}>{nameOf(selected)}</strong>
          <small title={selected.email}>{selected.email}</small>
        </span>
        <span className="person-picker-role">{roleOf(selected)}</span>
        <span className={'person-picker-chevron' + (open ? ' is-open' : '')} aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <div className="person-picker-panel">
          <label className="person-picker-search">
            <Icon name="search" />
            <input
              ref={searchInput}
              type="search"
              aria-label="Find a person"
              placeholder="Find by name or email"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <div id={listId} role="listbox" aria-label="People" className="person-picker-options">
            {visible.map((person) => (
              <button
                type="button"
                role="option"
                key={person.account_id}
                aria-selected={String(person.account_id) === String(selected.account_id)}
                disabled={disabled}
                onClick={() => {
                  onSelect(String(person.account_id));
                  close();
                }}
              >
                <ProfileAvatar user={person} />
                <span className="person-picker-identity">
                  <strong title={nameOf(person)}>{nameOf(person)}</strong>
                  <small title={person.email}>{person.email}</small>
                </span>
                <span className="person-picker-role">{roleOf(person)}</span>
                <span className="person-picker-check">
                  {String(person.account_id) === String(selected.account_id) && (
                    <Icon name="check" />
                  )}
                </span>
              </button>
            ))}
          </div>
          {pages > 1 && (
            <div className="person-picker-pagination">
              <span>
                {currentPage} of {pages}
              </span>
              <button
                type="button"
                className="btn"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous people
              </button>
              <button
                type="button"
                className="btn"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next people
              </button>
            </div>
          )}
          {!available.length && (
            <p role="status" className="person-picker-empty">
              No matching people. Try a different name or email.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
