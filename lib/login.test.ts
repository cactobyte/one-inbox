import { beforeEach, describe, expect, it } from "vitest";

import { parseSignup, registerAccount } from "@/lib/signup";
import { markEmailVerified } from "@/lib/verification";
import { makeTestDb } from "@/test/db";

import { checkLogin } from "./login";

let appDb: Awaited<ReturnType<typeof makeTestDb>>["appDb"];

beforeEach(async () => {
  ({ appDb } = await makeTestDb());
});

const signup = {
  businessName: "Fon's Bakery",
  name: "Fon",
  email: "fon@example.com",
  password: "sesame-open-now",
};

async function seedAgent(verified: boolean) {
  const { agentId } = await registerAccount(appDb, parseSignup(signup));
  if (verified) await markEmailVerified(appDb, agentId);
  return agentId;
}

describe("checkLogin", () => {
  it("returns ok for a verified agent with the right password", async () => {
    const agentId = await seedAgent(true);
    const outcome = await checkLogin(appDb, "  FON@example.com ", signup.password);
    expect(outcome).toEqual({
      status: "ok",
      agent: { id: agentId, sessionEpoch: 0 },
    });
  });

  it("returns unverified for the right password on an unconfirmed email", async () => {
    const agentId = await seedAgent(false);
    const outcome = await checkLogin(appDb, signup.email, signup.password);
    expect(outcome).toEqual({
      status: "unverified",
      agent: { id: agentId, email: "fon@example.com" },
    });
  });

  it("returns invalid for a wrong password — even when the email is unverified", async () => {
    await seedAgent(false);
    // The unverified state must not leak through a bad-password attempt.
    expect(await checkLogin(appDb, signup.email, "wrong")).toEqual({
      status: "invalid",
    });
  });

  it("returns invalid for an unknown email", async () => {
    expect(await checkLogin(appDb, "nobody@example.com", "whatever")).toEqual({
      status: "invalid",
    });
  });
});
