/**
 * Saves the interview in the browser's localStorage, so a refresh or an accidentally closed tab
 * doesn't lose it. Client-side only; nothing is sent anywhere.
 *
 * Restored data is validated with the same Zod schema as the API, so a corrupted or outdated
 * entry is discarded rather than crashing the page. Entries expire after SESSION_TTL_DAYS,
 * since they contain personal details (ID number, address).
 */
import { z } from "zod";
import { CaseFileSchema, FIELD_KEYS, type CaseFile, type ChatMessage, type FieldKey } from "./schema";
import type { DraftResult } from "./pipeline";
import type { ValidationIssue } from "./validate";

const KEY = "small-claims-session-v1";
const SESSION_TTL_DAYS = 7;

export type ChatItem = ChatMessage | { role: "notice"; issue: ValidationIssue };

export type SavedSession = {
  items: ChatItem[];
  input: string;
  caseFile: CaseFile;
  unknownFields: FieldKey[];
  raisedIssueCodes: string[];
  draft: DraftResult | null;
  savedAt: number;
};

const ItemSchema = z.union([
  z.object({ role: z.enum(["user", "assistant"]), content: z.string() }),
  z.object({
    role: z.literal("notice"),
    issue: z.object({ code: z.string(), severity: z.enum(["blocker", "warning", "info"]), message: z.string() }),
  }),
]);

const SavedSchema = z.object({
  items: z.array(ItemSchema).min(1),
  input: z.string(),
  caseFile: CaseFileSchema,
  unknownFields: z.array(z.string()),
  raisedIssueCodes: z.array(z.string()),
  // The draft is only displayed, so a light shape check is enough.
  draft: z.object({ draft: z.string() }).passthrough().nullable(),
  savedAt: z.number(),
});

export function loadSession(): SavedSession | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = SavedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || Date.now() - parsed.data.savedAt > SESSION_TTL_DAYS * 86_400_000) {
      clearSession();
      return null;
    }
    const s = parsed.data;
    return {
      ...s,
      unknownFields: s.unknownFields.filter((k): k is FieldKey => (FIELD_KEYS as readonly string[]).includes(k)),
      draft: s.draft as DraftResult | null,
    };
  } catch {
    return null; // storage blocked (private mode) or invalid JSON
  }
}

export function saveSession(s: Omit<SavedSession, "savedAt">) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...s, savedAt: Date.now() }));
  } catch {
    // Storage full or blocked — the app keeps working, it just won't survive a refresh.
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
