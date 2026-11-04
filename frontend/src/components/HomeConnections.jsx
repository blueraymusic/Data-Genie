import { Icon } from './Icon';

export function HomeConnections() {
  return (
    <section className="home-connections dark-surface" aria-label="Connections and platforms">
      <div className="wrap connection-strip">
        <p className="eyebrow">
          Works with your data.
          <br />
          Built on familiar tools.
        </p>
        <ul>
          <li>
            <Icon name="database" />
            <div>
              <strong>PostgreSQL</strong>
              <span>Live connection</span>
            </div>
          </li>
          <li>
            <Icon name="table" />
            <div>
              <strong className="sqlite-wordmark">SQLite</strong>
              <span>Upload or create</span>
            </div>
          </li>
          <li>
            <span className="azure-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <div>
              <strong>Microsoft Azure</strong>
              <span>Cloud hosting</span>
            </div>
          </li>
          <li>
            <svg className="github-mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.1c-3.14.68-3.8-1.34-3.8-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.73 2.65 1.23 3.3.94.1-.73.4-1.23.72-1.51-2.51-.29-5.15-1.26-5.15-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.44.11-3 0 0 .95-.3 3.08 1.16a10.72 10.72 0 0 1 5.6 0c2.14-1.46 3.08-1.16 3.08-1.16.62 1.56.23 2.71.11 3 .73.79 1.17 1.8 1.17 3.04 0 4.35-2.65 5.31-5.17 5.59.41.35.77 1.03.77 2.08v3.11c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z" />
            </svg>
            <div>
              <a href="https://github.com/blueraymusic/Data-Genie" target="_blank" rel="noreferrer">
                GitHub <span className="sr-only">source code (opens in a new tab)</span>
              </a>
              <span>Source code</span>
            </div>
          </li>
        </ul>
      </div>
    </section>
  );
}
