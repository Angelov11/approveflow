/**
 * Minimal shape of the Slack Events API outer envelope needed by this app —
 * either the one-time `url_verification` handshake, or an `event_callback`
 * wrapping an inner event. Both share the same request signature scheme as
 * every other Slack surface (see verify-request.ts), verified upstream of
 * this parser — this file only classifies an already-authenticated payload.
 *
 * M8.1: `app_uninstalled` and `tokens_revoked` are now subscribed (see
 * workspace lifecycle work) in addition to the existing `app_home_opened`.
 * `tokens_revoked`'s `event.tokens.bot` is an array of *bot user IDs* whose
 * bot token was revoked, not token strings — matched against our stored
 * `workspace.bot_user_id` by the caller (see events/route.ts), since this
 * parser only classifies the envelope and never touches the database.
 */
export interface SlackEventEnvelope {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: {
    type?: string;
    user?: string;
    /** Distinguishes the Home tab from the Messages tab — a `messages` open must never republish Home. */
    tab?: string;
    /** Present only on `tokens_revoked` — arrays of user IDs (`oauth`) and bot user IDs (`bot`) whose tokens were revoked. */
    tokens?: { oauth?: string[]; bot?: string[] };
  };
}

export type ParsedSlackEvent =
  | { kind: "url_verification"; challenge: string }
  | { kind: "app_home_opened"; slackTeamId: string; slackUserId: string }
  | { kind: "app_uninstalled"; slackTeamId: string }
  | { kind: "tokens_revoked"; slackTeamId: string; revokedBotUserIds: string[] }
  | { kind: "ignored" };

/** Never throws — any shape that doesn't match a known, well-formed case is safely classified as "ignored". */
export function parseSlackEvent(envelope: SlackEventEnvelope): ParsedSlackEvent {
  if (envelope.type === "url_verification") {
    return typeof envelope.challenge === "string" && envelope.challenge.length > 0
      ? { kind: "url_verification", challenge: envelope.challenge }
      : { kind: "ignored" };
  }

  if (envelope.type !== "event_callback") {
    return { kind: "ignored" };
  }

  if (envelope.event?.type === "app_home_opened" && envelope.event.tab === "home") {
    const slackTeamId = envelope.team_id;
    const slackUserId = envelope.event.user;
    if (slackTeamId && slackUserId) {
      return { kind: "app_home_opened", slackTeamId, slackUserId };
    }
    return { kind: "ignored" };
  }

  if (envelope.event?.type === "app_uninstalled") {
    const slackTeamId = envelope.team_id;
    return slackTeamId ? { kind: "app_uninstalled", slackTeamId } : { kind: "ignored" };
  }

  if (envelope.event?.type === "tokens_revoked") {
    const slackTeamId = envelope.team_id;
    if (!slackTeamId) {
      return { kind: "ignored" };
    }
    const revokedBotUserIds = Array.isArray(envelope.event.tokens?.bot)
      ? envelope.event.tokens.bot.filter((id): id is string => typeof id === "string")
      : [];
    return { kind: "tokens_revoked", slackTeamId, revokedBotUserIds };
  }

  return { kind: "ignored" };
}
