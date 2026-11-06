/**
 * Bots: named agents. Each has its own instructions, can use its own model, and keeps its own conversations.
 * The first, "Mobius", is always there and uses the settings as they are.
 *
 * A conversation belongs to a bot by its name: `c-<bot>-<random>` for a bot, `c-<random>` for Mobius.
 */

export const MAIN_BOT_ID = 'main';
export const MAIN_BOT_NAME = 'Mobius';
export const MAX_BOTS = 20;
export const MAX_BOT_NAME = 40;
export const MAX_BOT_INSTRUCTIONS = 4_000;

export interface Bot {
  /** `main`, or six lowercase letters and digits. */
  id: string;
  name: string;
  /** Added to the agent's usual instructions for this bot's conversations. */
  instructions: string;
  /** A model name to use for this bot, or '' for the one in the settings. */
  model: string;
  createdMs: number;
}

/** What the person fills in. */
export interface BotDraft { name: string; instructions: string; model: string }

export interface BotsState { bots: Bot[] }
export type BotResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const ID = /^[a-z0-9]{6}$/;
export const isBotId = (value: unknown): value is string => typeof value === 'string' && (value === MAIN_BOT_ID || ID.test(value));

const oneLine = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

/** A bot as the person described it: a name that is a plain line, instructions of bounded length, and a model name if any. */
export function parseBotDraft(value: unknown): BotDraft | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { name, instructions, model } = value as Record<string, unknown>;
  if (typeof name !== 'string' || typeof instructions !== 'string' || typeof model !== 'string') return null;
  const cleanName = name.trim();
  const cleanModel = model.trim();
  if (cleanName.length === 0 || cleanName.length > MAX_BOT_NAME || !oneLine(cleanName)) return null;
  if (instructions.length > MAX_BOT_INSTRUCTIONS || /\u0000/.test(instructions)) return null;
  if (cleanModel.length > 200 || !oneLine(cleanModel)) return null;
  return { name: cleanName, instructions: instructions.trim(), model: cleanModel };
}

/** The id of the bot a conversation belongs to, among the bots that exist. Anything else belongs to Mobius. */
export function botOfConversation(conversation: string, known: readonly string[]): string {
  const match = /^c-([a-z0-9]{6})-/.exec(conversation);
  const id = match?.[1];
  return id !== undefined && known.includes(id) ? id : MAIN_BOT_ID;
}

/** A new conversation id for a bot. `random` is a unique string of letters, digits and hyphens. */
export function conversationIdFor(bot: string, random: string): string {
  return bot === MAIN_BOT_ID ? `c-${random}` : `c-${bot}-${random}`;
}

export function parseBotRequest(value: unknown): { id: string; draft: BotDraft } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, draft } = value as Record<string, unknown>;
  const parsed = parseBotDraft(draft);
  return isBotId(id) && parsed ? { id, draft: parsed } : null;
}
