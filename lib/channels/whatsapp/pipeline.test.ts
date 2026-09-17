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

import { whatsappAdapter } from "./adapter";

/**
 * The whole inbound path for WhatsApp, end to end at the library layer:
 * verify the signature → `parseInbound` → `ingestInbound`, on a real (pglite)
 * Postgres. Nothing here is WhatsApp-specific below the adapter — the same
 * `ingestInbound` LINE and the widget use.
 */

const SECRET = "wa-app-secret";

let db: TestDb;
let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ db, appDb } = await makeTestDb());
});

function whatsappWebhook(text: string, messageId: string): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PN_ID" },
              contacts: [{ profile: { name: "Nok" }, wa_id: "66812345678" }],
              messages: [
                {
                  from: "66812345678",
                  id: messageId,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

describe("WhatsApp inbound pipeline", () => {
  it("verifies, normalises and ingests a real webhook body", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId, {
      type: "whatsapp",
      name: "WhatsApp",
      config: { appSecret: SECRET, accessToken: "tok", phoneNumberId: "PN_ID" },
    });

    const rawBody = whatsappWebhook("มีสินค้าไหมคะ", "wamid.1");
    const signature =
      "sha256=" + createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");

    const authentic = verifyInboundWebhook(
      "whatsapp",
      { header: (n) => (n.toLowerCase() === "x-hub-signature-256" ? signature : null), rawBody },
      { appSecret: SECRET },
    );
    expect(authentic).toBe(true);

    const [inbound] = whatsappAdapter.parseInbound(JSON.parse(rawBody), {});
    const result = await ingestInbound(appDb, channel, inbound);

    expect(result.status).toBe("created");

    const [conv] = await db.select().from(conversation);
    expect(conv.accountId).toBe(accountId);
    expect(conv.platformThreadId).toBe("66812345678");

    const [msg] = await db.select().from(message);
    expect(msg.body).toBe("มีสินค้าไหมคะ");
    expect(msg.direction).toBe("inbound");
    expect(msg.platformMessageId).toBe("wamid.1");
  });

  it("is idempotent on a redelivered webhook (same WhatsApp message id)", async () => {
    const accountId = await makeAccount(db);
    const channel = await makeChannel(db, accountId, {
      type: "whatsapp",
      config: { appSecret: SECRET },
    });

    const [inbound] = whatsappAdapter.parseInbound(
      JSON.parse(whatsappWebhook("hello", "wamid.dup")),
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
      type: "whatsapp",
      config: { appSecret: SECRET },
    });

    const rawBody = JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ wa_id: "66812345678" }],
                messages: [
                  {
                    from: "66812345678",
                    id: "b-1",
                    timestamp: "1700000000",
                    type: "text",
                    text: { body: "first" },
                  },
                  {
                    from: "66812345678",
                    id: "b-2",
                    timestamp: "1700000001",
                    type: "text",
                    text: { body: "second" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    for (const inbound of whatsappAdapter.parseInbound(JSON.parse(rawBody), {})) {
      await ingestInbound(appDb, channel, inbound);
    }

    const rows = await db.select().from(message);
    expect(rows.map((m) => m.body).sort()).toEqual(["first", "second"]);
    expect(await db.select().from(conversation)).toHaveLength(1);
  });
});
