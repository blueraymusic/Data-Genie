import { useState } from 'react';
import { encodeDatabase } from '../lib/api';
import { PostgresConnectionFields } from './PostgresConnectionFields';
export function DatabaseForm({ onOpen, busy = false }) {
  const [mode, setMode] = useState('create'),
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
  async function submit(event) {
    event.preventDefault();
    setError('');
    setReading(true);
    try {
      await onOpen(
        mode === 'postgresql'
          ? { database_mode: mode, ...postgres }
          : mode === 'upload'
            ? { database_mode: mode, name: file?.name, contents: await encodeDatabase(file) }
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
      <fieldset className="database-choice" disabled={busy || reading}>
        <legend>Choose your database</legend>
        <div className="database-modes">
          {[
            ['create', 'Create new', 'Start empty'],
            ['upload', 'Upload SQLite', 'Your existing file'],
            ['sample', 'Try the sample', 'Explore safely'],
            ['postgresql', 'PostgreSQL', 'Connect a live database'],
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
            Drop a SQLite file here, or choose one. Up to 25 MB. You work on a copy and can download
            your changes.
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
        />
      )}
      <button className="btn pri start-button" disabled={busy || reading}>
        {busy || reading
          ? 'Opening database…'
          : mode === 'postgresql'
            ? 'Connect PostgreSQL'
            : mode === 'create'
              ? 'Create database & start'
              : mode === 'upload'
                ? 'Attach database'
                : 'Open sample database'}
      </button>
      <p className="err" role="status">
        {error}
      </p>
    </form>
  );
}
