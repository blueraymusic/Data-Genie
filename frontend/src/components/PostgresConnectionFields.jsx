import { useState } from 'react';
import { api } from '../lib/api';

export function PostgresConnectionFields({ value, onChange, disabled }) {
  const [visible, setVisible] = useState(false),
    [testing, setTesting] = useState(false),
    [result, setResult] = useState(null),
    [error, setError] = useState('');
  function change(key, next) {
    onChange({ ...value, [key]: next });
    setResult(null);
    setError('');
  }
  async function test() {
    setTesting(true);
    setResult(null);
    setError('');
    try {
      setResult(await api('/api/connections/test', { method: 'POST', body: value }));
    } catch (error) {
      setError(error.message);
    } finally {
      setTesting(false);
    }
  }
  return (
    <fieldset className="postgres-fields" disabled={disabled || testing}>
      <legend className="sr-only">PostgreSQL connection</legend>
      <p className="small muted">
        Connect a live database, including PostgreSQL on Supabase or Neon.
      </p>
      <label htmlFor="postgresName">
        Connection name <span className="muted">(optional)</span>
      </label>
      <input
        id="postgresName"
        value={value.database_name}
        maxLength={150}
        placeholder="My PostgreSQL database"
        onChange={(event) => change('database_name', event.target.value)}
      />
      <label htmlFor="postgresUrl">PostgreSQL connection URL</label>
      <div className="postgres-url">
        <input
          id="postgresUrl"
          type={visible ? 'text' : 'password'}
          value={value.connection_url}
          onChange={(event) => change('connection_url', event.target.value)}
          required
          autoComplete="off"
          spellCheck="false"
          placeholder="postgresql://user:password@host:5432/database"
          maxLength={4096}
        />
        <button
          className="text-button"
          type="button"
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? 'Hide URL' : 'Show URL'}
        </button>
      </div>
      <label htmlFor="postgresSchema">Schema</label>
      <input
        id="postgresSchema"
        value={value.schema_name}
        onChange={(event) => change('schema_name', event.target.value)}
        required
        maxLength={63}
        autoComplete="off"
      />
      <label className="check-label">
        <input
          type="checkbox"
          checked={value.allow_changes}
          onChange={(event) => change('allow_changes', event.target.checked)}
          aria-describedby="postgresChangesHelp"
        />
        Allow changes after I confirm them
      </label>
      <p className="small muted" id="postgresChangesHelp">
        Read-only by default. With changes enabled, confirmed edits are saved directly in this
        database. No download or upload is needed to save them.
      </p>
      <p className="small muted">
        Remote connections use SSL, and credentials are encrypted on this computer.
      </p>
      <button
        className="btn"
        type="button"
        disabled={!value.connection_url.trim() || testing}
        onClick={test}
      >
        {testing ? 'Testing connection…' : 'Test connection'}
      </button>
      <div className="connection-test-result" role="status">
        {result && (
          <p className="ok">
            Connected to {result.database} · {result.schema_name} · {result.table_count}{' '}
            {result.table_count === 1 ? 'table' : 'tables'}
          </p>
        )}
        {error && <p className="err">{error}</p>}
      </div>
    </fieldset>
  );
}
