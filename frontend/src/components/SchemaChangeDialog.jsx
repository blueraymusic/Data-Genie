import { useState } from 'react';
import { Modal } from './Modal';
import { schemaColumnTypes, schemaStatement } from '../lib/schemaSql';

const titles = {
  'create-table': 'Create table',
  'rename-table': 'Rename table',
  'delete-table': 'Delete table',
  'add-column': 'Add column',
  'rename-column': 'Rename column',
  'delete-column': 'Delete column',
};

export function SchemaChangeDialog({ change, tables, session, disabled, onReview, onClose }) {
  const { action, table, column } = change;
  const [name, setName] = useState(
      action === 'rename-table' ? table.name : action === 'rename-column' ? column.name : '',
    ),
    [type, setType] = useState('TEXT'),
    [error, setError] = useState('');
  const deleting = action.startsWith('delete-');
  const columnChange = action.endsWith('column');
  function prepare(event) {
    event.preventDefault();
    if (disabled) return;
    try {
      const sql = schemaStatement({ ...change, name, type, tables, session });
      onReview(sql);
    } catch (error) {
      setError(error.message);
    }
  }
  return (
    <Modal titleId="schemaChangeTitle" onClose={onClose}>
      <form onSubmit={prepare}>
        <h2 id="schemaChangeTitle">{titles[action]}</h2>
        {table && (
          <p className="muted schema-dialog-target">
            Table: <strong>{table.name}</strong>
            {column && (
              <>
                <br />
                Column: <strong>{column.name}</strong>
              </>
            )}
          </p>
        )}
        <p className="muted">
          {action === 'create-table'
            ? 'Start with an automatically generated id primary key, then add columns from Structure.'
            : action === 'add-column'
              ? 'The new column allows empty values. Existing rows start with NULL.'
              : action === 'delete-table'
                ? 'Deleting this table removes its columns and all its rows.'
                : action === 'delete-column'
                  ? 'Deleting this column removes its values from every row. Related constraints may prevent this change.'
                  : 'The new name keeps the existing data.'}{' '}
          Review the SQL and confirm before anything changes.
        </p>
        {!deleting && (
          <>
            <label htmlFor="schemaChangeName">
              {action.startsWith('rename-') ? 'New ' : ''}
              {columnChange ? 'column' : 'table'} name
            </label>
            <input
              id="schemaChangeName"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
              required
              maxLength={100}
              autoFocus
              autoComplete="off"
              disabled={disabled}
            />
          </>
        )}
        {action === 'add-column' && (
          <>
            <label htmlFor="schemaColumnType">Column type</label>
            <select
              id="schemaColumnType"
              value={type}
              onChange={(event) => setType(event.target.value)}
              disabled={disabled}
            >
              {schemaColumnTypes(session).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn pri" disabled={disabled}>
            Review {deleting ? 'deletion' : 'change'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
