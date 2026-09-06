# Changelog

What shipped, newest first. One entry per milestone. The reasoning is in
`docs/decisions.md`; the detail is in git history.

---

## Week 1 (Sept 2026) — website widget MVP

Live at https://one-inbox-xi.vercel.app. One channel: website chat.

- **Foundations.** Next.js App Router, Drizzle + Neon Postgres, the
  seven-table schema (migration `0000`), agent email/password auth
  (`scrypt` + stateless signed-cookie sessions), GitHub Actions CI.
- **Channel adapters + message flow.** Two-method `ChannelAdapter` interface,
  the website adapter, the adapter registry, the normalised `Message` model.
  Idempotent inbound ingestion endpoint (one transaction) and the outbound
  reply path. pglite test harness. Migration `0001` (platform-identity
  columns).
- **Website widget.** Standalone `tsc`-built embed — one `<script>` tag,
  shadow DOM, visitor identity in `localStorage`. SSE receive with native
  `Last-Event-ID` resume. Migration `0002` (`timestamptz(3)` for the cursor).
- **Agent inbox.** Account-scoped query layer (`lib/inbox/queries.ts`),
  conversation list + thread view + reply form. An agent's reply reaches an
  open widget live.
- **Production / demo readiness.** Deployment made publicly reachable
  (Vercel deployment protection turned off), seed password de-hardcoded,
  live end-to-end and resilience testing, demo runbook (`docs/demo.md`).
