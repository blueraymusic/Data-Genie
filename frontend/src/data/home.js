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
