import { useState } from 'react';
import { api } from '../lib/api';

export function PostgresConnectionFields({ value, onChange, disabled, submitting }) {
  const [visible, setVisible] = useState(false),
    [optionsOpen, setOptionsOpen] = useState(
      Boolean(value.database_name || (value.schema_name && value.schema_name !== 'public')),
    ),
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
        Read-only by default. Enabling changes lets confirmed edits update this live database.
      </p>
      <details
        className="postgres-options"
        open={optionsOpen}
        onToggle={(event) => setOptionsOpen(event.currentTarget.open)}
      >
        <summary>
          Connection options{' '}
          <span className="small muted">{value.schema_name || 'public'} schema</span>
        </summary>
        <div className="postgres-option-fields">
          <label htmlFor="postgresName">
            Connection name <span className="muted">(optional)</span>
            <input
              id="postgresName"
              value={value.database_name}
              maxLength={150}
              placeholder="My PostgreSQL database"
              onChange={(event) => change('database_name', event.target.value)}
            />
          </label>
          <label htmlFor="postgresSchema">
            Schema
            <input
              id="postgresSchema"
              value={value.schema_name}
              placeholder="public"
              onChange={(event) => change('schema_name', event.target.value)}
              maxLength={63}
              autoComplete="off"
            />
          </label>
        </div>
        <p className="small muted">Remote connections use SSL. Saved credentials are encrypted.</p>
      </details>
      <div className="postgres-actions">
        <button
          className="btn"
          type="button"
          disabled={!value.connection_url.trim() || testing}
          onClick={test}
        >
          {testing ? 'Testing connection…' : 'Test connection'}
        </button>
        <button
          className="btn pri start-button"
          type="submit"
          disabled={disabled || testing || !value.connection_url.trim()}
        >
          {submitting ? 'Opening database…' : 'Connect PostgreSQL'}
        </button>
      </div>
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
