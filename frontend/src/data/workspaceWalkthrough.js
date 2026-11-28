import { customerLookup, sampleCustomers, sampleUpdate } from './homeSamples';

export const walkthroughSteps = [
  [
    'entry',
    '.gate-intro',
    'Welcome to Data Genie',
    'Start by choosing a database. This tour shows you the screens and controls you’ll use most.',
  ],
  [
    'entry',
    '.saved-databases',
    'Recent databases',
    'Open a database you used before and continue with its saved history.',
  ],
  [
    'entry',
    '[data-tour="database-create"]',
    'Create a database',
    'Start with an empty SQLite database. Give it a name, then add your tables in Structure.',
  ],
  [
    'entry',
    '.sqlite-upload-zone',
    'Upload a SQLite file',
    'Choose a SQLite file or drop it here. Data Genie works on a copy of the file.',
    'upload',
  ],
  [
    'entry',
    '.postgres-url',
    'Connect PostgreSQL',
    'Paste a PostgreSQL connection URL. Test the connection first. Read-only access is the default.',
    'postgresql',
  ],
  [
    'entry',
    '.start-button',
    'Try the sample database',
    'Open the sample to practice with customers, products, and sales. The next steps show a sample workspace.',
    'sample',
  ],
  [
    'ask',
    '[aria-label="Main navigation"], [aria-label="Mobile navigation"]',
    'Find your way around',
    'Use this navigation to switch databases, open Teams, return to Workspace, or find past requests in History.',
  ],
  [
    'ask',
    '[aria-label="Workspace views"]',
    'Switch workspace views',
    'Ask takes plain-language requests, SQL runs statements you write, and Structure shows your tables and columns.',
  ],
  [
    'ask',
    '#tableRail .rail-search, .rail-toggle',
    'Find a table or column',
    'Search the table list and expand a table to see its columns. On smaller screens, open Tables & database.',
  ],
  [
    'ask',
    '#v-ask .chips',
    'Start with a suggestion',
    'Choose a suggested request to put it in the composer. Suggestions reflect the selected table.',
  ],
  [
    'ask',
    '#v-ask .composer',
    'Ask a question',
    'Type in plain language when Data Genie AI is available. Use the attachment button for a reference PDF or image.',
  ],
  [
    'ask',
    '#feed .translation-commands',
    'Read the generated SQL',
    'Data Genie shows the SQL beside your request. Read or copy it to see exactly how the answer was produced.',
    'result',
  ],
  [
    'ask',
    '#feed .exchange-results',
    'Use the results',
    'Read the returned rows here. You can sort a column, copy the rows, or download a CSV when your permissions allow.',
    'result',
  ],
  [
    'ask',
    '#feed .confirm',
    'Review a change',
    'Changes wait for your approval. Read what will change, then confirm it or choose Don’t run.',
    'confirmation',
  ],
  [
    'sql',
    '#v-sql .sql-editor',
    'Run SQL directly',
    'Enter a SQLite or PostgreSQL statement and choose Run SQL. This editor works without an AI service.',
  ],
  [
    'sql',
    '#v-sql .sql-composer-tools',
    'Find SQL help',
    'Open examples for a starting query or use the syntax guide to look up supported statements.',
  ],
  [
    'schema',
    '.schema-toolbar',
    'Browse and manage structure',
    'Jump to a table or create a new one. Data Genie shows a review before a structure change runs.',
  ],
  [
    'schema',
    '#schema .tbl',
    'Inspect a table',
    'See data types, primary keys, and relationships. Use Sample rows to look at the data in a table.',
  ],
  [
    'history',
    '.history-search-row',
    'Search History',
    'Find an earlier request by its text, SQL operation, or database.',
  ],
  [
    'history',
    '.history-entry',
    'Open a saved request',
    'Check the saved SQL and result. Use request puts the original request back in Workspace.',
  ],
  [
    'workspaces',
    '.workspace-selected-heading h2',
    'Work with a team',
    'Create or join a workspace in Teams. A team workspace keeps shared databases and reports together.',
  ],
  [
    'workspaces',
    '.workspace-section-tabs button:nth-child(2)',
    'Find team reports',
    'Open Reports to draft or read shared findings. Your role determines what you can edit or publish.',
  ],
  [
    'workspaces',
    '.workspace-section-tabs button:nth-child(3)',
    'Manage people and access',
    'Workspace owners can invite teammates and control what each person can do with a database.',
  ],
  [
    'account',
    '.account-profile',
    'Manage your profile',
    'Open Account & preferences to edit your name or photo and find your sign-in details.',
  ],
  [
    'account',
    '.account-theme-switch',
    'Choose an appearance',
    'Switch between light and dark mode here or from the theme control in the header.',
  ],
  [
    'account',
    '.account-workspace-setting h3',
    'Set your default workspace view',
    'Choose Ask or SQL as your starting view when you open a database.',
  ],
  [
    'account',
    '.account-security-panel .account-panel-heading',
    'Manage sign-in and security',
    'Find your password settings, workspace ownership transfer, and account deletion here.',
  ],
  [
    'account',
    '.account-agent-section > summary',
    'Connect an agent',
    'Agents & API is where you find the connection details and manage which agents have access.',
  ],
  [
    'account',
    '[data-tour="replay"]',
    'Take the walkthrough again',
    'You can replay this tour from Account & preferences, just below Default workspace view.',
  ],
];

const schema = [
  {
    name: 'customers',
    row_count: sampleCustomers.length,
    columns: [
      { name: 'customer_id', type: 'INTEGER', primary_key: true },
      { name: 'name', type: 'TEXT' },
      { name: 'state', type: 'TEXT' },
    ],
  },
  {
    name: 'products',
    row_count: 5,
    columns: [
      { name: 'product_id', type: 'INTEGER', primary_key: true },
      { name: 'name', type: 'TEXT' },
    ],
  },
];
const startedAt = new Date().toISOString();
const session = {
  session_id: 'walkthrough-example',
  database_id: 'walkthrough-example',
  database: 'Sample shop',
  source: 'demo',
  started_at: startedAt,
  tables: schema.map(({ name }) => name),
  table_details: schema,
  ai: { enabled: true },
};
const lookup = customerLookup('Iowa');
const result = {
  request_id: 1,
  text: 'Show customers from Iowa',
  submitted_at: startedAt,
  status: 'executed',
  commands: [
    {
      command_id: 1,
      operation: 'SELECT',
      sql: lookup.sql,
      status: 'executed',
      rows: lookup.rows,
      columns: ['name', 'state'],
      kind: 'SELECT',
      matched: true,
    },
  ],
};
const confirmation = {
  request_id: 2,
  text: 'Change Priya Nair’s state to Kansas',
  submitted_at: startedAt,
  status: 'pending',
  commands: [
    {
      command_id: 2,
      operation: 'UPDATE',
      sql: sampleUpdate.sql,
      status: 'pending',
      requires_confirmation: true,
      preview: { table: 'customers', affected_rows: 1 },
    },
  ],
};
const team = { workspace_id: 'walkthrough-team', name: 'Sample team', role: 'owner' };
export const walkthroughTeam = {
  workspaces: [
    {
      workspace_id: 'walkthrough-personal',
      name: 'Personal workspace',
      role: 'owner',
      personal: true,
    },
    team,
  ],
  details: { workspace: team, databases: [], members: [], invitations: [] },
};
const base = { preview: true, loading: false, workingCommands: new Set() };
const workspace = { ...base, session, feed: [] };
const examples = {
  result: { ...workspace, feed: [result] },
  confirmation: { ...workspace, feed: [confirmation], pending: true },
};

export function walkthroughWorkbench(view, example) {
  if (view === 'entry') return base;
  if (view === 'history') return examples.result;
  return examples[example] || workspace;
}

export const walkthroughSQL = lookup.sql;
