import { useState } from 'react';
import { sampleHistory } from '../data/home';
export function HomeHistory() {
  const [filter, setFilter] = useState('deletes');
  const rows = sampleHistory.filter((row) => !filter || row.filters.includes(filter));
  return (
    <section className="sec wrap" id="record" aria-labelledby="rec-h">
      <h2 id="rec-h">On the record</h2>
      <p className="lede">
        Every request is kept with the SQL it produced and its result. Search it, filter it, and
        open any result again.
      </p>
      <div className="hist" aria-label="Sample history">
        <div className="hist-top" role="group" aria-label="Quick filters">
          {[
            ['deletes', 'Deletes this week'],
            ['dropped', 'Dropped tables'],
            ['declined', 'Declined'],
            ['nu', 'Not understood'],
          ].map(([id, label]) => (
            <button
              className="fbtn"
              type="button"
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(filter === id ? '' : id)}
            >
              {label}
            </button>
          ))}
          <span className="total" aria-live="polite">
            {rows.length} {rows.length === 1 ? 'request' : 'requests'}
          </span>
        </div>
        <div className="scroll">
          <table className="ht">
            <colgroup>
              <col style={{ width: 158 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: '23%' }} />
              <col />
              <col style={{ width: 112 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 140 }} />
            </colgroup>
            <thead>
              <tr>
                {['When', 'Database', 'Request', 'SQL', 'Operation', 'Rows', 'Status'].map(
                  (label) => (
                    <th scope="col" key={label}>
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.when}>
                  <td className="when">{row.when}</td>
                  <td className="db">shop.sqlite</td>
                  <td className="rq">{row.request}</td>
                  <td>
                    {row.sql ? (
                      <span className="sq" title={row.sql}>
                        {row.sql}
                      </span>
                    ) : (
                      <span className="nosql">No SQL created</span>
                    )}
                  </td>
                  <td>
                    {row.operation && (
                      <span className={'chip op op-' + row.operation.toLowerCase()}>
                        {row.operation}
                      </span>
                    )}
                  </td>
                  <td className="rows">{row.rows ?? ''}</td>
                  <td>
                    <span
                      className={'chip st-' + (row.status === 'not understood' ? 'nu' : row.status)}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hist-foot">
          Illustrative sample history. Your own requests are saved in your dashboard.
        </p>
      </div>
    </section>
  );
}
