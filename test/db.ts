import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { AppDb } from "@/db";
import * as schema from "@/db/schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * A throwaway Postgres (pglite, in-process, WASM) with the checked-in
 * migrations applied. Real SQL, real constraints — so the dedupe unique
 * index and account scoping are exercised, not mocked.
 */
export async function makeTestDb(): Promise<{ db: TestDb; appDb: AppDb }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./db/migrations" });
  return { db, appDb: db as unknown as AppDb };
}

let counter = 0;

/** Insert an account and return its id. */
export async function makeAccount(db: TestDb, name?: string): Promise<string> {
  const [row] = await db
    .insert(schema.account)
    .values({ name: name ?? `Account ${++counter}` })
    .returning({ id: schema.account.id });
  return row.id;
}

/** Insert a channel for an account and return its id. Defaults to the widget. */
export async function makeChannel(
  db: TestDb,
  accountId: string,
  options: {
    type?: schema.ChannelType;
    name?: string;
    config?: Record<string, unknown>;
  } = {},
): Promise<{ id: string; accountId: string }> {
  const [row] = await db
    .insert(schema.channel)
    .values({
      accountId,
      type: options.type ?? "widget",
      name: options.name ?? "Website",
      config: options.config ?? {},
    })
    .returning({ id: schema.channel.id });
  return { id: row.id, accountId };
}

/** Insert an agent for an account and return the minimal actor shape. */
export async function makeAgent(
  db: TestDb,
  accountId: string,
  options: {
    role?: schema.AgentRole;
    email?: string;
    name?: string;
    emailVerifiedAt?: Date | null;
  } = {},
): Promise<{ id: string; accountId: string; role: schema.AgentRole; email: string }> {
  const email = options.email ?? `agent${++counter}@example.test`;
  const role = options.role ?? "agent";
  const [row] = await db
    .insert(schema.agent)
    .values({
      accountId,
      email,
      passwordHash: "x",
      name: options.name ?? "Test Agent",
      role,
      emailVerifiedAt: options.emailVerifiedAt ?? null,
    })
    .returning({ id: schema.agent.id });
  return { id: row.id, accountId, role, email };
}
