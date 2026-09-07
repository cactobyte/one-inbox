/**
 * Bootstrap one account, one owner agent, and one website (widget) channel
 * so you can sign in and exercise the inbound endpoint.
 *
 * Run after migrating:
 *   SEED_AGENT_EMAIL=you@example.com SEED_AGENT_PASSWORD=secret \
 *   node --env-file=.env --experimental-strip-types db/seed.ts
 *
 * There is no signup UI yet (see docs/backlog.md); this is how the first
 * agent is created. Self-contained (own DB client) so it runs under plain
 * Node without a TypeScript path resolver.
 */
import { randomBytes } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";

import { account, agent, channel } from "./schema.ts";
import { hashPassword } from "../lib/password.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set (pass --env-file=.env).");
  process.exit(1);
}

const db = drizzle(neon(connectionString), { schema: { account, agent, channel } });

const accountName = process.env.SEED_ACCOUNT_NAME ?? "Demo Co";
const email = (process.env.SEED_AGENT_EMAIL ?? "owner@example.com")
  .trim()
  .toLowerCase();
// No default: a hardcoded password in a public repo is a published
// credential (see docs/decisions.md, day 5). The caller must supply one.
const password = process.env.SEED_AGENT_PASSWORD;
if (!password) {
  console.error(
    "SEED_AGENT_PASSWORD is not set. Choose a password and pass it, e.g.\n" +
      "  SEED_AGENT_PASSWORD=... node --env-file=.env --experimental-strip-types db/seed.ts",
  );
  process.exit(1);
}

const existing = await db
  .select({ id: agent.id, accountId: agent.accountId })
  .from(agent)
  .where(eq(agent.email, email))
  .limit(1);

let accountId: string;

if (existing.length > 0) {
  accountId = existing[0].accountId;
  console.log(`Agent ${email} already exists — reusing its account.`);
} else {
  const [acct] = await db
    .insert(account)
    .values({ name: accountName })
    .returning({ id: account.id });
  accountId = acct.id;

  await db.insert(agent).values({
    accountId,
    email,
    passwordHash: await hashPassword(password),
    name: process.env.SEED_AGENT_NAME ?? "Owner",
    role: "owner",
  });
  console.log(`Created account "${accountName}" and agent ${email}.`);
}

const [existingChannel] = await db
  .select({ id: channel.id, config: channel.config })
  .from(channel)
  .where(and(eq(channel.accountId, accountId), eq(channel.type, "widget")))
  .limit(1);

if (existingChannel) {
  const token = (existingChannel.config as { inboundToken?: string }).inboundToken;
  console.log(`Website channel already exists: ${existingChannel.id}`);
  if (token) console.log(`  inbound token: ${token}`);
} else {
  const inboundToken = randomBytes(24).toString("hex");
  const [ch] = await db
    .insert(channel)
    .values({
      accountId,
      type: "widget",
      name: "Website",
      config: { inboundToken },
    })
    .returning({ id: channel.id });
  console.log(`Created website channel: ${ch.id}`);
  console.log(`  inbound token: ${inboundToken}`);
  console.log(
    `  POST http://localhost:3000/api/channels/${ch.id}/inbound  (header x-channel-token)`,
  );
}

// LINE channel (M1) — only when its credentials are supplied. There is no
// integrations UI yet (roadmap M7 moves these to encrypted per-tenant
// storage); until then the channel secret and access token live in
// `channel.config`, exactly as the widget's inbound token does.
const lineChannelSecret = process.env.SEED_LINE_CHANNEL_SECRET;
const lineAccessToken = process.env.SEED_LINE_CHANNEL_ACCESS_TOKEN;

if (lineChannelSecret) {
  const [existingLine] = await db
    .select({ id: channel.id })
    .from(channel)
    .where(and(eq(channel.accountId, accountId), eq(channel.type, "line")))
    .limit(1);

  if (existingLine) {
    await db
      .update(channel)
      .set({
        config: {
          channelSecret: lineChannelSecret,
          channelAccessToken: lineAccessToken ?? null,
        },
      })
      .where(eq(channel.id, existingLine.id));
    console.log(`Updated LINE channel config: ${existingLine.id}`);
  } else {
    const [ch] = await db
      .insert(channel)
      .values({
        accountId,
        type: "line",
        name: process.env.SEED_LINE_CHANNEL_NAME ?? "LINE",
        config: {
          channelSecret: lineChannelSecret,
          channelAccessToken: lineAccessToken ?? null,
        },
      })
      .returning({ id: channel.id });
    console.log(`Created LINE channel: ${ch.id}`);
    console.log(
      `  Set the LINE webhook URL to https://<deployment>/api/channels/${ch.id}/inbound`,
    );
  }
}

process.exit(0);
