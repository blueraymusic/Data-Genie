// Illustrative homepage data. These interactions never contact a database.
import { demos } from './home';

export const sampleCustomers = [
  { customer_id: 1, name: 'Ana Brooks', state: 'Illinois' },
  ...demos[0].rows.map(({ customer_id, name, state }) => ({
    customer_id,
    name,
    state,
  })),
  { customer_id: 10, name: 'Avery Chen', state: 'Iowa' },
  { customer_id: 11, name: 'Sam Patel', state: 'Kansas' },
];
export const sampleStates = ['Missouri', 'Iowa', 'Illinois', 'Kansas'];
export function customerLookup(state) {
  return {
    request: `show customers from ${state}`,
    sql: `SELECT name, state FROM customers\nWHERE state = '${state}';`,
    rows: sampleCustomers
      .filter((row) => row.state === state)
      .map(({ name, state }) => ({ name, state })),
  };
}
export const sampleUpdate = {
  request: 'change Priya Nair’s state to Kansas',
  sql: "UPDATE customers\nSET state = 'Kansas'\nWHERE customer_id = 5;",
  operation: 'UPDATE',
  description: 'Changes one customer’s state from Missouri to Kansas.',
};
export const tourHistory = [
  {
    id: 'lookup',
    request: demos[0].request,
    sql: demos[0].sql,
    operation: 'SELECT',
    status: 'executed',
    result: '3 customers found in Missouri.',
  },
  {
    id: 'count',
    request: 'how many customers are in each state',
    sql: 'SELECT state, COUNT(*) AS customers\nFROM customers\nGROUP BY state;',
    operation: 'SELECT',
    status: 'executed',
    result: '6 customers across 4 states.',
  },
  {
    id: 'change',
    ...sampleUpdate,
    status: 'declined',
    result: 'Not run. You declined this change.',
  },
];
