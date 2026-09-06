# One Inbox — Full Roadmap

Read alongside docs/vision.md. Work through milestones in order. After each:
add a short section to docs/changelog.md (what shipped) and a decisions.md
entry (choices + what was rejected), then propose the next milestone and wait
for a go-ahead. Do not skip ahead or batch multiple milestones without saying
so first. No per-milestone log file — the changelog is the log.

## PHASE 1 — Prove the architecture (multi-channel core)

M1. LINE adapter — webhook verification, inbound normalize, outbound send,
    wired through existing pipeline, zero interface changes (or documented
    reason why one was needed). [done if: real LINE test message round-trips]

M2. Multi-channel inbox — conversations from website + LINE in one list,
    replies routed via correct adapter, UI has zero channel-awareness.
    [done if: agent replies to a LINE conversation and a website conversation
    from the same inbox with no code branching visible in UI layer]

M3. Hardening — SSE transient-drop recovery actually verified (not just
    reasoned about), staging DB separated from prod, revisit agent.email
    uniqueness and session revocation flags — resolve or explicitly defer
    each with a written reason. [done if: all four Day-1 flags are closed
    or consciously deferred, not silently forgotten]

## PHASE 2 — Multi-tenant self-serve product

M4. Self-serve signup — email + password, verification email, creates a new
    account (tenant) on success.

M5. Password reset flow.

M6. Team management — invite teammate by email, they set a password, join
    the inviter's account. Basic roles (owner vs agent) if not already
    implied by existing schema.

M7. Settings/integrations UI — business owner connects their OWN channel
    credentials (LINE API keys etc.) through the UI, not env vars or code.
    Credentials stored encrypted at rest, scoped to account_id.

M8. Per-tenant channel management — enable/disable a channel, see connection
    status, reconnect on credential failure/expiry.

M9. Billing scaffolding — plan tiers defined (even if only one free tier
    exists functionally), Stripe or equivalent wired for future paid plans.
    Does not need real pricing decided yet — just the plumbing.

M10. Onboarding flow — first-login experience walks a new account through
     connecting a channel and inviting a teammate. Doesn't need to be
     polished, needs to exist.

## PHASE 3 — Beyond the inbox

M11. Contact/CRM basics — contact profile shows history across all channels,
     basic notes field.

M12. Additional channel adapters as needed — Messenger, Instagram, WhatsApp,
     Shopee, Lazada, TikTok Shop, in priority order TBD by actual demand.

M13. Broadcast messaging — send one message to many contacts across channels.

M14. AI-assisted replies — suggested responses, possibly auto-reply rules.

M15+. Anything else — genuinely unscoped until Phase 1 and 2 are real and
      Jesper's actual usage tells you what matters. Do not pre-build.

## Rules that don't change regardless of pace
- Architecture rules in vision.md are non-negotiable at any milestone.
- Every new channel MUST fit the adapter interface without special-casing
  outside the adapter. If it doesn't fit, that's a real finding — flag it,
  don't force it.
- Every new table/tenant-facing feature MUST be account_id scoped from the
  first line of code, not retrofitted.
- Test what you built before calling a milestone done — especially anything
  touching a live third-party API, real money (billing), or auth/credentials.
  Bugs found by running the thing, not by reading the code, are what caught
  everything real in Days 1-5. Don't skip that step just because the
  milestone is bigger now.