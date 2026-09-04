/**
 * A resumable cursor over `message (created_at, id)` — the day 2 schema
 * already has both columns, so this needs no migration. `id` (a UUID) is
 * only a tiebreaker for rows with an identical timestamp; it gives a total
 * order without one, which is what a resumable stream needs.
 *
 * Used for both the SSE stream's `Last-Event-ID` resume (day 3) and list
 * pagination (day 4) — the same "give me everything after this point"
 * problem either way.
 */

export type Cursor = { createdAt: Date; id: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

/** Returns null for anything malformed — callers treat that as "from the start". */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.lastIndexOf("|");
    if (sep < 0) return null;
    const createdAt = new Date(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || id === "") return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
