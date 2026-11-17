import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server.ts';

let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) {
    appPromise = createApp();
  }
  const app = await appPromise;
  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
