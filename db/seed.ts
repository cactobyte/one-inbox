/**
 * Bootstrap one account and one owner agent so you can sign in.
 *
 * Run once, after migrating:
 *   SEED_AGENT_EMAIL=you@example.com SEED_AGENT_PASSWORD=secret \
 *   node --env-file=.env --experimental-strip-types db/seed.ts
 *
 * There is no signup UI yet (see docs/backlog.md); this is how the first
 * agent is created. Self-contained (own DB client) so it runs under plain
 * Node without a TypeScript path resolver.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";

import { account, agent } from "./schema.ts";
import { hashPassword } from "../lib/password.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set (pass --env-file=.env).");
  process.exit(1);
}

const db = drizzle(neon(connectionString), { schema: { account, agent } });

const accountName = process.env.SEED_ACCOUNT_NAME ?? "Demo Co";
const email = (process.env.SEED_AGENT_EMAIL ?? "owner@example.com")
  .trim()
  .toLowerCase();
const password = process.env.SEED_AGENT_PASSWORD ?? "changeme123";

const existing = await db
  .select({ id: agent.id })
  .from(agent)
  .where(eq(agent.email, email))
  .limit(1);

if (existing.length > 0) {
  console.log(`Agent ${email} already exists — nothing to do.`);
  process.exit(0);
}

const [acct] = await db
  .insert(account)
  .values({ name: accountName })
  .returning({ id: account.id });

await db.insert(agent).values({
  accountId: acct.id,
  email,
  passwordHash: await hashPassword(password),
  name: process.env.SEED_AGENT_NAME ?? "Owner",
  role: "owner",
});

console.log(`Created account "${accountName}" and agent ${email}.`);
process.exit(0);
