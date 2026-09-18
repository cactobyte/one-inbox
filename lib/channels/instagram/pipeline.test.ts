import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { conversation, event, message } from "@/db/schema";
import { verifyInboundWebhook } from "@/lib/channels/verify";
import { ingestInbound } from "@/lib/inbox/ingest";
import { makeAccount, makeChannel, makeTestDb, type TestDb } from "@/test/db";

import { instagramAdapter } from "./adapter";

/**
 * The whole inbound path for Instagram, end to end at the library layer:
 * verify the signature → `parseInbound` → `ingestInbound`, on a real (pglite)
 * Postgres. Nothing here is Instagram-specific below the adapter.
 */

const SECRET = "ig-app-secret";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

function instagramWebhook(text: string, mid: string): string {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: "IG_ID",
        messaging: [
          {
            sender: { id: "IGSID_1" },
            recipient: { id: "IG_ID" },
            timestamp: 1700000000000,
            message: { mid, text },
          },
        ],
      },
    ],
  });
}

describe("Instagram inbound pipeline", () => {
  it("verifies, normalises and ingests a real webhook body", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId, {
      type: "instagram",
      name: "Instagram",
      config: { appSecret: SECRET, pageAccessToken: "tok" },
    });

    const rawBody = instagramWebhook("มีสินค้าไหมคะ", "mid.1");
    const signature =
      "sha256=" + createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");

    const authentic = verifyInboundWebhook(
      "instagram",
      { header: (n) => (n.toLowerCase() === "x-hub-signature-256" ? signature : null), rawBody },
      { appSecret: SECRET },
    );
    expect(authentic).toBe(true);

    const [inbound] = instagramAdapter.parseInbound(JSON.parse(rawBody), {});
    const result = await ingestInbound(appDb, channel, inbound);

    expect(result.status).toBe("created");

    const [conv] = await db.select().from(conversation);
    expect(conv.accountId).toBe(accountId);
    expect(conv.platformThreadId).toBe("IGSID_1");

    const [msg] = await db.select().from(message);
    expect(msg.body).toBe("มีสินค้าไหมคะ");
    expect(msg.direction).toBe("inbound");
    expect(msg.platformMessageId).toBe("mid.1");
  });

  it("is idempotent on a redelivered webhook (same Instagram mid)", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId, {
      type: "instagram",
      config: { appSecret: SECRET },
    });

    const [inbound] = instagramAdapter.parseInbound(
      JSON.parse(instagramWebhook("hello", "mid.dup")),
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
