"use server";

import { redirect } from "next/navigation";

import { db } from "@/db";
import { requireAgent } from "@/lib/auth";
import { updateContactNotes } from "@/lib/contacts";

/** Overwrite a contact's notes. Plain action, no client state — same shape
 * as `app/team/actions.ts`'s cancel/resend. */
export async function saveNotes(formData: FormData): Promise<void> {
  const agent = await requireAgent();
  const contactId = String(formData.get("contactId") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  await updateContactNotes(db, agent.accountId, contactId, notes === "" ? null : notes);
  redirect(`/contacts/${contactId}`);
}
