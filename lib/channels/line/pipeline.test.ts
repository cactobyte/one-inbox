import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { conversation, event, message } from "@/db/schema";
import { verifyInboundWebhook } from "@/lib/channels/verify";
import { ingestInbound } from "@/lib/inbox/ingest";
import {
  makeAccount,
  makeChannel,
  makeTestDb,
  type TestDb,
} from "@/test/db";

import { lineAdapter } from "./adapter";

/**
 * The whole inbound path for LINE, end to end at the library layer:
 * verify the signature → `parseInbound` → `ingestInbound`, on a real (pglite)
 * Postgres. Nothing here is LINE-specific below the adapter — the same
 * `ingestInbound` the widget uses.
 */

const SECRET = "line-secret";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

function lineWebhook(text: string, messageId: string): string {
  return JSON.stringify({
    destination: "U_oa",
    events: [
      {
        type: "message",
        timestamp: 1_700_000_000_000,
        source: { type: "user", userId: "U_nok" },
        message: { type: "text", id: messageId, text },
      },
    ],
  });
}

describe("LINE inbound pipeline", () => {
  it("verifies, normalises and ingests a real webhook body", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId, {
      type: "line",
      name: "LINE OA",
      config: { channelSecret: SECRET, channelAccessToken: "cat" },
    });

    const rawBody = lineWebhook("มีสินค้าไหมคะ", "line-1");
    const signature = createHmac("sha256", SECRET)
      .update(rawBody, "utf8")
      .digest("base64");

    const authentic = verifyInboundWebhook(
      "line",
      { header: (n) => (n.toLowerCase() === "x-line-signature" ? signature : null), rawBody },
      { channelSecret: SECRET },
    );
    expect(authentic).toBe(true);

    const [inbound] = lineAdapter.parseInbound(JSON.parse(rawBody), {});
    const result = await ingestInbound(appDb, channel, inbound);

    expect(result.status).toBe("created");

    const [conv] = await db.select().from(conversation);
    expect(conv.accountId).toBe(accountId);
    expect(conv.platformThreadId).toBe("U_nok");

    const [msg] = await db.select().from(message);
    expect(msg.body).toBe("มีสินค้าไหมคะ");
    expect(msg.direction).toBe("inbound");
    expect(msg.platformMessageId).toBe("line-1");
  });

  it("is idempotent on a redelivered webhook (same LINE message id)", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId, {
      type: "line",
      config: { channelSecret: SECRET },
    });

    const [inbound] = lineAdapter.parseInbound(
      JSON.parse(lineWebhook("hello", "line-dup")),
      {},
    );

    const first = await ingestInbound(appDb, channel, inbound);
    const second = await ingestInbound(appDb, channel, inbound);

    expect(first.status).toBe("created");
    expect(second.status).toBe("duplicate");
    expect(await db.select().from(message)).toHaveLength(1);
    expect(
      (await db.select().from(event)).map((e) => e.type).sort(),
    ).toEqual(["created", "message_received"]);
  });

  it("ingests both messages from one batched delivery", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId, {
      type: "line",
      config: { channelSecret: SECRET },
    });

    const rawBody = JSON.stringify({
      events: [
        {
          type: "message",
          timestamp: 1_700_000_000_000,
          source: { type: "user", userId: "U_nok" },
          message: { type: "text", id: "b-1", text: "first" },
        },
        {
          type: "message",
          timestamp: 1_700_000_000_001,
          source: { type: "user", userId: "U_nok" },
          message: { type: "text", id: "b-2", text: "second" },
        },
      ],
    });

    for (const inbound of lineAdapter.parseInbound(JSON.parse(rawBody), {})) {
      await ingestInbound(appDb, channel, inbound);
    }

    const rows = await db.select().from(message);
    expect(rows.map((m) => m.body).sort()).toEqual(["first", "second"]);
    expect(await db.select().from(conversation)).toHaveLength(1);
  });
});
