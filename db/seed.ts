/**
 * Bootstrap one account and one owner agent so you can sign in.
 *
 * Run once, after migrating:
 *   DATABASE_URL=... SESSION_SECRET=... \
 *   SEED_AGENT_EMAIL=you@example.com SEED_AGENT_PASSWORD=secret \
 *   node --experimental-strip-types db/seed.ts
 *
 * There is no signup UI yet (see docs/backlog.md); this is how the first
 * agent is created.
 */
import { eq } from "drizzle-orm";

import { db } from "./index.ts";
import { account, agent } from "./schema.ts";
import { hashPassword } from "../lib/password.ts";

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
