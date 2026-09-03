import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = NeonDatabase<Schema>;

let pool: Pool | undefined;
let client: Database | undefined;

/**
 * Lazily-created Neon client. Uses the WebSocket pool driver (not neon-http)
 * because the inbound ingest path needs a real multi-statement transaction —
 * find-or-create the contact and conversation, write the message, write the
 * event, bump the counters, all or nothing. Node 22 has a global WebSocket,
 * so no `ws` polyfill is needed.
 *
 * Created on first query, not on import, so `next build` and tooling don't
 * need DATABASE_URL just to load a module.
 */
function getDb(): Database {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env and add a Neon connection string.",
      );
    }
    pool = new Pool({ connectionString });
    client = drizzle(pool, { schema });
  }
  return client;
}

export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
