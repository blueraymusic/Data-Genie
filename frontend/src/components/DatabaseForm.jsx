import { useEffect, useRef, useState } from 'react';
import { encodeDatabase } from '../lib/api';
import { PostgresConnectionFields } from './PostgresConnectionFields';
import { useEnterMotion } from '../hooks/useMotion';
export function DatabaseForm({ onOpen, busy = false, initialMode = 'create' }) {
  const form = useRef(null),
    details = useRef(null);
  const [mode, setMode] = useState(initialMode),
    [file, setFile] = useState(null),
    [name, setName] = useState('my_database.sqlite3'),
    [starter, setStarter] = useState(false),
    [error, setError] = useState(''),
    [reading, setReading] = useState(false),
    [postgres, setPostgres] = useState({
      database_name: '',
      connection_url: '',
      schema_name: 'public',
      allow_changes: false,
    });
  useEnterMotion(details, mode);
  useEffect(() => {
    if (initialMode === 'postgresql') form.current?.querySelector('#postgresUrl')?.focus();
  }, [initialMode]);
  async function submit(event) {
    event.preventDefault();
    setError('');
    setReading(true);
    try {
      await onOpen(
        mode === 'postgresql'
          ? { database_mode: mode, ...postgres }
          : mode === 'upload'
            ? {
                database_mode: mode,
                name: file?.name,
                contents: await encodeDatabase(file),
              }
            : { database_mode: mode, database_name: name, starter },
      );
      if (mode === 'postgresql') setPostgres((previous) => ({ ...previous, connection_url: '' }));
    } catch (error) {
      setError(error.message);
    } finally {
      setReading(false);
    }
  }
  return (
    <form
      className="database-form"
      ref={form}
      onSubmit={submit}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (busy || reading || !event.dataTransfer.files[0]) return;
        setFile(event.dataTransfer.files[0]);
        setMode('upload');
        setError('');
      }}
    >
      <div className="database-form-heading">
        <h2>Add a database</h2>
        <p className="small muted">Choose where to start.</p>
      </div>
      <fieldset className="database-choice" disabled={busy || reading}>
        <legend className="sr-only">Choose your database</legend>
        <div className="database-modes">
          {[
            ['create', 'Create new', 'A blank SQLite database'],
            ['upload', 'Upload SQLite', 'Work on a copy of your file'],
            ['postgresql', 'PostgreSQL', 'Connect a live database'],
            ['sample', 'Try the sample', 'Customers, products, and sales'],
          ].map(([value, label, hint]) => (
            <label key={value}>
              <input
                type="radio"
                name="database_mode"
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  setError('');
                }}
              />
              <span>
                <b>{label}</b>
                <small>{hint}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div ref={details} className="database-details">
        {mode === 'create' && (
          <div className="database-fields">
            <label htmlFor="databaseName">Database name</label>
            <input
              id="databaseName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={150}
              required
              disabled={busy || reading}
            />
            <p className="small muted database-field-note">You can add tables after opening it.</p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={starter}
                onChange={(event) => setStarter(event.target.checked)}
                disabled={busy || reading}
              />
              Include an example notes table
            </label>
          </div>
        )}
        {mode === 'upload' && (
          <div className="database-fields">
            <label htmlFor="databaseFile">SQLite file</label>
            <input
              id="databaseFile"
              type="file"
              accept=".db,.sqlite,.sqlite3"
              onChange={(event) => setFile(event.target.files[0])}
              required={!file}
              disabled={busy || reading}
            />
            {file && <p className="small muted">Selected: {file.name}</p>}
            <p className="small muted">
              Drop a SQLite file here, or choose one. Up to 25 MB. You work on a copy and can
              download your changes.
            </p>
          </div>
        )}
        {mode === 'sample' && (
          <p className="small muted">
            The sample contains customers, products, and sales. Ask “show all customers from
            Missouri”.
          </p>
        )}
        {mode === 'postgresql' && (
          <PostgresConnectionFields
            value={postgres}
            onChange={setPostgres}
            disabled={busy || reading}
            submitting={busy || reading}
          />
        )}
      </div>
      {mode !== 'postgresql' && (
        <button className="btn pri start-button" disabled={busy || reading}>
          {busy || reading
            ? 'Opening database…'
            : mode === 'create'
              ? 'Create database'
              : mode === 'upload'
                ? 'Open SQLite file'
                : 'Open sample database'}
        </button>
      )}
      <p className="err" role="status">
        {error}
      </p>
    </form>
  );
}
