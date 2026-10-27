export const demos = [
  {
    request: 'show all customers from Missouri',
    operation: 'SELECT',
    sql: "SELECT * FROM customers\nWHERE state = 'Missouri';",
    note: 'Finds every customer whose state is Missouri.',
    rows: [
      { customer_id: 2, name: 'Jon Reyes', email: 'jon.reyes@example.com', state: 'Missouri' },
      { customer_id: 5, name: 'Priya Nair', email: 'priya.nair@example.com', state: 'Missouri' },
      { customer_id: 9, name: 'Tom Whitaker', email: 'tom.w@example.com', state: 'Missouri' },
    ],
  },
  {
    request: 'average sale amount by category',
    operation: 'SELECT',
    sql: 'SELECT p.category,\n       ROUND(AVG(s.amount), 2) AS average_amount\nFROM sales AS s\nJOIN products AS p ON p.product_id = s.product_id\nGROUP BY p.category\nORDER BY average_amount DESC;',
    note: 'Joined sales to products on sales.product_id, then averaged the amount for each category.',
    rows: [
      { category: 'Outdoor', average_amount: '61.40' },
      { category: 'Kitchen', average_amount: '48.75' },
      { category: 'Office', average_amount: '37.20' },
      { category: 'Toys', average_amount: '22.90' },
    ],
  },
  {
    request: 'add a customer named Ana Lee in Missouri',
    operation: 'INSERT',
    sql: "INSERT INTO customers (name, state)\nVALUES ('Ana Lee', 'Missouri');",
    note: 'Prepares one new customer. Data Genie waits for your OK before adding it.',
  },
];
export const examples = [
  {
    title: 'Look things up',
    items: [
      demos[0],
      {
        request: 'list the five most expensive products',
        operation: 'SELECT',
        sql: 'SELECT name, price FROM products\nORDER BY price DESC\nLIMIT 5;',
      },
    ],
  },
  {
    title: 'Add and change records',
    items: [
      demos[2],
      {
        request: 'change the Toys category to Games',
        operation: 'UPDATE',
        sql: "UPDATE products SET category = 'Games'\nWHERE category = 'Toys';",
      },
    ],
  },
  {
    title: 'Summarize',
    items: [
      {
        request: 'how many sales has each customer made',
        operation: 'SELECT',
        sql: 'SELECT customer_id, COUNT(*) AS sale_count\nFROM sales\nGROUP BY customer_id;',
      },
      {
        request: 'total sales amount by category',
        operation: 'SELECT',
        sql: 'SELECT p.category, SUM(s.amount) AS total\nFROM sales AS s\nJOIN products AS p ON p.product_id = s.product_id\nGROUP BY p.category;',
      },
    ],
  },
  {
    title: 'Shape your tables',
    items: [
      {
        request: 'create a table notes with a body',
        operation: 'CREATE',
        sql: 'CREATE TABLE notes (\n  id INTEGER PRIMARY KEY,\n  body TEXT NOT NULL\n);',
      },
      {
        request: 'add a column phone to customers',
        operation: 'ALTER',
        sql: 'ALTER TABLE customers\nADD COLUMN phone TEXT;',
      },
    ],
  },
];
export const sampleHistory = [
  {
    when: 'Today, 2:12 PM',
    request: 'delete sales from before 2024',
    sql: "DELETE FROM sales WHERE sale_date < '2024-01-01';",
    operation: 'DELETE',
    rows: 3,
    status: 'executed',
    filters: ['deletes'],
  },
  {
    when: 'Today, 1:58 PM',
    request: 'average sale amount by category',
    sql: 'SELECT p.category, ROUND(AVG(s.amount), 2) FROM sales AS s JOIN products AS p ...',
    operation: 'SELECT',
    status: 'executed',
    filters: [],
  },
  {
    when: 'Yesterday, 9:03 AM',
    request: 'delete customers with no email',
    sql: 'DELETE FROM customers WHERE email IS NULL;',
    operation: 'DELETE',
    rows: 2,
    status: 'executed',
    filters: ['deletes'],
  },
  {
    when: 'Yesterday, 9:01 AM',
    request: 'drop table legacy_import',
    sql: 'DROP TABLE legacy_import;',
    operation: 'DROP',
    status: 'declined',
    filters: ['dropped', 'declined'],
  },
  {
    when: 'Tue, 4:47 PM',
    request: 'drop table legacy_import',
    sql: 'DROP TABLE legacy_import;',
    operation: 'DROP',
    status: 'executed',
    filters: ['dropped'],
  },
  {
    when: 'Tue, 4:40 PM',
    request: 'make the customers happier',
    sql: '',
    operation: '',
    status: 'not understood',
    filters: ['nu'],
  },
  {
    when: 'Mon, 11:20 AM',
    request: 'delete products in Toys',
    sql: "DELETE FROM products WHERE category = 'Toys';",
    operation: 'DELETE',
    status: 'declined',
    filters: ['deletes', 'declined'],
  },
];
