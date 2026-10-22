import { client } from './generated/client.gen';

// Use the page's origin so development requests go through Vite's /api proxy.
client.setConfig({
  baseUrl: globalThis.location?.origin ?? 'http://localhost:8080',
});

export { client as apiClient };
export { reviewSnippet } from './generated/sdk.gen';
export type * from './generated/types.gen';
