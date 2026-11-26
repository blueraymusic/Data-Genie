import { useEffect, useId, useRef, useState } from 'react';
import { databaseUploadProblem, encodeDatabase } from '../lib/api';
import { Icon } from './Icon';
import { PostgresConnectionFields } from './PostgresConnectionFields';
import { useFileDrop } from '../hooks/useFileDrop';
import { useEnterMotion } from '../hooks/useMotion';
export function DatabaseForm({ onOpen, busy = false, initialMode = 'create', preview = false }) {
  const form = useRef(null),
    details = useRef(null),
    fileInput = useRef(null);
  const uploadHint = useId();
  const [mode, setMode] = useState(initialMode),
    [file, setFile] = useState(null),
    [uploadName, setUploadName] = useState(''),
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
  const blocked = busy || reading;
  const fileDrop = useFileDrop({ disabled: blocked, onFiles: attachFiles });
  useEnterMotion(details, mode, !preview);
  useEffect(() => {
    if (!preview && initialMode === 'postgresql')
      form.current?.querySelector('#postgresUrl')?.focus();
  }, [initialMode, preview]);
  function attachFiles(files) {
    if (files.length !== 1) {
      setError('Choose one SQLite database at a time.');
      return;
    }
    const [selected] = files;
    const problem = databaseUploadProblem(selected);
    if (problem) {
      setError(problem);
      return;
    }
    setFile(selected);
    setUploadName(selected.name);
    setMode('upload');
    setError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (blocked || (mode === 'upload' && !file)) return;
    setError('');
    setReading(true);
    try {
      await onOpen(
        mode === 'postgresql'
          ? { database_mode: mode, ...postgres }
          : mode === 'upload'
            ? {
                database_mode: mode,
                name: uploadName || file.name,
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
      className={
        'database-form' + (fileDrop.active && mode !== 'upload' ? ' is-file-drop-target' : '')
      }
      ref={form}
      onSubmit={submit}
      {...fileDrop.handlers}
    >
      <div className="database-form-heading">
        <h2>Add a database</h2>
        <p className="small muted">
          {mode === 'upload'
            ? 'Choose where to start.'
            : fileDrop.active
              ? 'Release to attach your SQLite file.'
              : 'Choose where to start, or drop a SQLite file here.'}
        </p>
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
            <label key={value} data-tour={'database-' + value}>
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
          <div className="database-fields sqlite-upload-fields">
            <input
              ref={fileInput}
              type="file"
              aria-label="SQLite file"
              accept=".db,.sqlite,.sqlite3"
              hidden
              disabled={blocked}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files);
                event.currentTarget.value = '';
                if (files.length) attachFiles(files);
              }}
            />
            <div
              className="sqlite-upload-zone"
              data-selected={Boolean(file)}
              data-dragging={fileDrop.active}
            >
              <span className="sqlite-upload-icon">
                <Icon name={file && !fileDrop.active ? 'database' : 'upload'} />
              </span>
              <div className="sqlite-upload-copy" aria-live="polite">
                <strong>
                  {fileDrop.active
                    ? 'Release to attach the file'
                    : file?.name || 'Drop a SQLite file here'}
                </strong>
                <small id={uploadHint}>
                  {file && !fileDrop.active
                    ? 'Ready to open'
                    : '.db, .sqlite, .sqlite3 · Up to 25 MB'}
                </small>
              </div>
              <button
                className="btn sqlite-upload-action"
                type="button"
                aria-describedby={uploadHint}
                disabled={blocked}
                onClick={() => fileInput.current?.click()}
              >
                {file ? 'Replace file' : 'Choose file'}
              </button>
            </div>
            <p className="sqlite-upload-note">
              <Icon name="copy" /> Data Genie opens a copy. Your original file stays intact.
            </p>
            {file && (
              <label className="sqlite-upload-name">
                Save database as
                <input
                  value={uploadName}
                  onChange={(event) => setUploadName(event.target.value)}
                  maxLength={150}
                  required
                  disabled={blocked}
                />
              </label>
            )}
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
        <button className="btn pri start-button" disabled={blocked || (mode === 'upload' && !file)}>
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
