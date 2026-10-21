import type { ReviewInput } from '../types/review';

export const examples: Record<
  'database' | 'javascript' | 'python' | 'go',
  ReviewInput
> = {
  database: {
    title: 'Fetch a user by ID',
    language: 'typescript',
    context: 'An API handler that looks up a user in our database.',
    code: [
      "import { db } from './database';",
      '',
      'export async function getUser(userId: string) {',
      "  const query = `SELECT * FROM users WHERE id = '${userId}'`;",
      '',
      '  const users = await db.query(query);',
      "  console.log('User result:', users);",
      '',
      '  return users[0];',
      '}',
    ].join('\n'),
  },
  javascript: {
    title: 'Calculate a result',
    language: 'javascript',
    context: 'The expression comes from a text input.',
    code: "export function calculate(expression) {\n  const result = eval(expression);\n  console.log('Result:', result);\n  return result;\n}",
  },
  python: {
    title: 'Process a user expression',
    language: 'python',
    context: 'A small helper used by an interactive calculator.',
    code: 'def calculate(expression):\n    result = eval(expression)\n    print(result)\n    return result',
  },
  go: {
    title: 'Look up a user',
    language: 'go',
    context: 'A database lookup using a user-provided ID.',
    code: 'func getUser(db *sql.DB, id string) (*sql.Rows, error) {\n\tquery := fmt.Sprintf("SELECT * FROM users WHERE id = \'%s\'", id)\n\treturn db.Query(query)\n}',
  },
};
