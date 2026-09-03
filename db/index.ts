import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "./schema";

let client: NeonHttpDatabase<typeof schema> | undefined;

/**
 * Lazily-created Neon HTTP client. Created on first query, not on import, so
 * `next build` and tooling don't need DATABASE_URL just to load a module.
 * Neon's HTTP driver is stateless, so there is no pool to manage on Vercel.
 */
function getDb(): NeonHttpDatabase<typeof schema> {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env and add a Neon connection string.",
      );
    }
    client = drizzle(neon(connectionString), { schema });
  }
  return client;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export type Database = NeonHttpDatabase<typeof schema>;
