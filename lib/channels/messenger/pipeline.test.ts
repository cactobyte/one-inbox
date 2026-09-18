import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { conversation, event, message } from "@/db/schema";
import { verifyInboundWebhook } from "@/lib/channels/verify";
import { ingestInbound } from "@/lib/inbox/ingest";
import { makeAccount, makeChannel, makeTestDb, type TestDb } from "@/test/db";

import { messengerAdapter } from "./adapter";

/**
 * The whole inbound path for Messenger, end to end at the library layer:
 * verify the signature → `parseInbound` → `ingestInbound`, on a real (pglite)
 * Postgres. Nothing here is Messenger-specific below the adapter.
 */

const SECRET = "fb-app-secret";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

function messengerWebhook(text: string, mid: string): string {
  return JSON.stringify({
    object: "page",
    entry: [
      {
        id: "PAGE_ID",
        messaging: [
          {
            sender: { id: "PSID_1" },
            recipient: { id: "PAGE_ID" },
            timestamp: 1700000000000,
            message: { mid, text },
          },
        ],
      },
    ],
  });
}

describe("Messenger inbound pipeline", () => {
  it("verifies, normalises and ingests a real webhook body", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId, {
      type: "messenger",
      name: "Messenger",
      config: { appSecret: SECRET, pageAccessToken: "tok" },
    });

    const rawBody = messengerWebhook("มีสินค้าไหมคะ", "mid.1");
    const signature =
      "sha256=" + createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");

    const authentic = verifyInboundWebhook(
      "messenger",
      { header: (n) => (n.toLowerCase() === "x-hub-signature-256" ? signature : null), rawBody },
      { appSecret: SECRET },
    );
    expect(authentic).toBe(true);

    const [inbound] = messengerAdapter.parseInbound(JSON.parse(rawBody), {});
    const result = await ingestInbound(appDb, channel, inbound);

    expect(result.status).toBe("created");

    const [conv] = await db.select().from(conversation);
    expect(conv.accountId).toBe(accountId);
    expect(conv.platformThreadId).toBe("PSID_1");

    const [msg] = await db.select().from(message);
    expect(msg.body).toBe("มีสินค้าไหมคะ");
    expect(msg.direction).toBe("inbound");
    expect(msg.platformMessageId).toBe("mid.1");
  });

  it("is idempotent on a redelivered webhook (same Messenger mid)", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId, {
      type: "messenger",
      config: { appSecret: SECRET },
    });

    const [inbound] = messengerAdapter.parseInbound(
      JSON.parse(messengerWebhook("hello", "mid.dup")),
      {},
    );

    const first = await ingestInbound(appDb, channel, inbound);
    const second = await ingestInbound(appDb, channel, inbound);

    expect(first.status).toBe("created");
    expect(second.status).toBe("duplicate");
    expect(await db.select().from(message)).toHaveLength(1);
    expect((await db.select().from(event)).map((e) => e.type).sort()).toEqual([
      "created",
      "message_received",
    ]);
  });
});
