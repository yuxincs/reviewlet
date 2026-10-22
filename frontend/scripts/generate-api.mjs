import { fileURLToPath } from 'node:url';
import { createClient } from '@hey-api/openapi-ts';

await createClient({
  input: fileURLToPath(new URL('../../api/openapi.yaml', import.meta.url)),
  output: fileURLToPath(new URL('../src/api/generated/', import.meta.url)),
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
