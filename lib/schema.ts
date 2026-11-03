import { z } from "zod";

/**
 * "תיק התביעה" — the structured case file the interview fills in.
 * Every leaf is nullable: null means "not collected yet". The model never invents values;
 * if the user says they don't know something, the field's key goes into `unknown_fields`.
 *
 * Dates are ISO strings: "YYYY-MM-DD", or "YYYY-MM" / "YYYY" when the user only knows part of it.
 */

export const PartySchema = z.object({
  full_name: z.string().nullable(),
  id_number: z.string().nullable().describe("ת.ז. של התובע, ספרות בלבד"),
  address: z.string().nullable(),
  phone: z.string().nullable(),
});

export const DefendantSchema = z.object({
  name: z.string().nullable().describe("שם הנתבע כפי שמופיע ברשומות (שם החברה / שם בעל העסק / שם האדם)"),
  entity_type: z
    .enum(["company", "licensed_dealer", "individual", "unknown"])
    .nullable()
    .describe("company = חברה בע\"מ (ח.פ.), licensed_dealer = עוסק מורשה/פטור, individual = אדם פרטי"),
  registration_number: z.string().nullable().describe("ח.פ. / ע.מ. / ת.ז. של הנתבע"),
  address: z.string().nullable(),
});

export const DatedEventSchema = z.object({
  date: z.string().nullable().describe("YYYY-MM-DD / YYYY-MM / YYYY, או null אם לא ידוע"),
  description: z.string(),
});

export const AmountItemSchema = z.object({
  item: z.string().describe("רכיב הסכום, למשל: מחיר המזגן, עוגמת נפש"),
  amount: z.number().describe("בש\"ח"),
});

export const SettlementAttemptSchema = z.object({
  date: z.string().nullable(),
  method: z.string().describe("טלפון / הגעה לחנות / מייל / וואטסאפ וכו'"),
  result: z.string().nullable(),
});

export const EvidenceSchema = z.object({
  description: z.string().describe("למשל: קבלה, חוזה שכירות, צילומי הודעות"),
  in_possession: z.boolean().nullable().describe("האם המסמך נמצא בידי התובע"),
});

export const CaseFileSchema = z.object({
  case_type: z
    .enum(["consumer_purchase", "rental_deposit", "services", "damages", "other"])
    .nullable()
    .describe("סוג המחלוקת"),
  plaintiff: PartySchema,
  defendant: DefendantSchema,
  incident_date: z
    .string()
    .nullable()
    .describe("התאריך שבו נולדה עילת התביעה (למשל מועד הקנייה/התקלה, מועד סיום השכירות). משמש לבדיקת התיישנות"),
  timeline: z.array(DatedEventSchema).describe("אירועים מתוארכים לפי סדר כרונולוגי"),
  facts: z
    .array(z.string())
    .describe("עובדות המקרה כפי שהמשתמש מסר אותן, משפט עובדתי אחד לכל פריט. בלי פרשנות ובלי השלמות"),
  amount: z.object({
    total: z.number().nullable().describe("סכום התביעה הכולל בש\"ח"),
    breakdown: z.array(AmountItemSchema),
  }),
  settlement: z.object({
    attempts: z.array(SettlementAttemptSchema),
    demand_letter_sent: z.boolean().nullable().describe("האם נשלח מכתב התראה / דרישה לפני תביעה"),
    demand_letter_date: z.string().nullable(),
  }),
  evidence: z.array(EvidenceSchema),
});

export type CaseFile = z.infer<typeof CaseFileSchema>;

/** Keys the user can mark as "unknown" (used both by the model and the UI). */
export const FIELD_KEYS = [
  "plaintiff.full_name",
  "plaintiff.id_number",
  "plaintiff.address",
  "plaintiff.phone",
  "defendant.name",
  "defendant.registration_number",
  "defendant.address",
  "incident_date",
  "facts",
  "amount.total",
  "amount.breakdown",
  "settlement.attempts",
  "settlement.demand_letter_sent",
  "evidence",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** What the interview model returns on every turn. */
export const InterviewTurnSchema = z.object({
  case_file: CaseFileSchema.describe("תיק התביעה המעודכן במלואו: הערכים הקודמים + מה שהמשתמש מסר עכשיו"),
  unknown_fields: z
    .array(z.enum(FIELD_KEYS))
    .describe("שדות שהמשתמש אמר במפורש שאינו יודע / אין לו. יסומנו [להשלמה] והשיחה תמשיך"),
  flags: z
    .array(
      z.object({
        type: z.enum(["off_topic", "fabrication_request", "inconsistency", "not_small_claims", "other"]),
        note: z.string(),
      }),
    )
    .describe("אירועים חריגים בתור הנוכחי"),
  missing_fields: z.array(z.enum(FIELD_KEYS)).describe("שדות שעדיין חסרים, לפי סדר חשיבות"),
  next_questions: z.array(z.string()).describe("1–2 שאלות ממוקדות לשאול עכשיו"),
  assistant_message: z.string().describe("ההודעה שתוצג למשתמש בעברית: תגובה קצרה + השאלות הבאות"),
});
export type InterviewTurn = z.infer<typeof InterviewTurnSchema>;

/** What the Critic returns. */
export const CritiqueSchema = z.object({
  issues: z.array(
    z.object({
      category: z.enum([
        "unsupported_fact",
        "amount_mismatch",
        "date_mismatch",
        "missing_attachment",
        "missing_placeholder",
        "structure",
        "hebrew_quality",
        "legal_overreach",
      ]),
      severity: z.enum(["high", "medium", "low"]),
      quote: z.string().describe("הציטוט הבעייתי מתוך הטיוטה (או ריק אם זה חוסר)"),
      explanation: z.string(),
      suggested_fix: z.string(),
    }),
  ),
  summary: z.string().describe("סיכום קצר בעברית של איכות הטיוטה"),
});
export type Critique = z.infer<typeof CritiqueSchema>;

export function emptyCaseFile(): CaseFile {
  return {
    case_type: null,
    plaintiff: { full_name: null, id_number: null, address: null, phone: null },
    defendant: { name: null, entity_type: null, registration_number: null, address: null },
    incident_date: null,
    timeline: [],
    facts: [],
    amount: { total: null, breakdown: [] },
    settlement: { attempts: [], demand_letter_sent: null, demand_letter_date: null },
    evidence: [],
  };
}

export type ChatMessage = { role: "user" | "assistant"; content: string };
