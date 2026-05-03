import type { AgentAnimationConfig, AgentSession } from "../agents/types.ts";

/** Static alive glyph for remote-backed sessions — matches the `↗` prefix
 *  used on the remote pane border, so the agent tree and the pane itself
 *  agree on "this is running somewhere else". */
const REMOTE_ALIVE_CHAR = "\u2197";

export function getStatusChar(
  session: AgentSession,
  animations: AgentAnimationConfig,
): { char: string; color: string } {
  if (session.status === "unanswered") {
    return { char: animations.unanswered.char, color: animations.unanswered.color };
  }
  if (session.isRemote) {
    return { char: REMOTE_ALIVE_CHAR, color: animations.alive.color };
  }
  return { char: animations.alive.char, color: animations.alive.color };
}
