import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and add a Neon connection string.",
  );
}

// One Neon HTTP client per serverless invocation. Neon's driver is stateless
// over HTTP, so there is no pool to manage on Vercel.
export const db = drizzle(neon(connectionString), { schema });

export type Database = typeof db;
