import type { ConversationChannel } from "@/lib/inbox/queries";

/**
 * A small label showing which channel a conversation is on — "Website",
 * "LINE", whatever the channel is named. Pure display: it renders
 * `channel.name` and passes `channel.type` through to `data-channel` for
 * styling/tests. Nothing in the UI branches on the type (CLAUDE.md rule 2).
 */
export function ChannelTag({ channel }: { channel: ConversationChannel }) {
  return (
    <span className="chan" data-channel={channel.type}>
      {channel.name}
    </span>
  );
}
