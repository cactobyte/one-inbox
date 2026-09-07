import type { ChannelType } from "@/db/schema";

import type { ChannelAdapter } from "./adapter";
import { lineAdapter } from "./line/adapter";
import { websiteAdapter } from "./website/adapter";

/**
 * The one place that maps a channel type to its adapter. Every other part of
 * the system asks here rather than branching on the type itself (CLAUDE.md
 * architecture rule 2). New channels register here and nowhere else.
 */
const ADAPTERS: Partial<Record<ChannelType, ChannelAdapter>> = {
  widget: websiteAdapter,
  line: lineAdapter,
};

/** Raised when a channel row has a type with no adapter wired up. */
export class UnknownChannelError extends Error {
  constructor(type: string) {
    super(`No adapter registered for channel type "${type}"`);
    this.name = "UnknownChannelError";
  }
}

export function getAdapter(type: ChannelType): ChannelAdapter {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new UnknownChannelError(type);
  return adapter;
}
