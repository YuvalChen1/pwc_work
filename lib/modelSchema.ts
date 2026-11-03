/**
 * The model-facing shape of the case file.
 *
 * Structured outputs compile the JSON schema into a grammar; the nested, nullable CaseFile schema
 * compiles to a grammar that is too large. So the model reads and writes a flat version where
 * "" (or 0 for the amount) means "not collected yet", and the code converts it to/from CaseFile.
 */
import { z } from "zod";
import type { CaseFile } from "./schema";

export const ModelCaseFileSchema = z.object({
  case_type: z.string().describe("consumer_purchase / rental_deposit / services / damages / other, או \"\""),
  plaintiff_full_name: z.string(),
  plaintiff_id_number: z.string(),
  plaintiff_address: z.string(),
  plaintiff_phone: z.string(),
  defendant_name: z.string().describe("השם הרשמי אם ידוע, אחרת שם החנות/העסק כפי שנמסר"),
  defendant_entity_type: z.string().describe("company / licensed_dealer / individual / unknown, או \"\""),
  defendant_registration_number: z.string().describe("ח.פ. / ע.מ. / ת.ז. של הנתבע"),
  defendant_address: z.string(),
  incident_date: z.string().describe("YYYY-MM-DD / YYYY-MM / YYYY — מועד היווצרות עילת התביעה"),
  timeline: z.array(z.object({ date: z.string(), description: z.string() })),
  facts: z.array(z.string()),
  amount_total: z.number().describe("סכום התביעה בש\"ח; 0 אם עדיין לא נמסר"),
  amount_breakdown: z.array(z.object({ item: z.string(), amount: z.number() })),
  settlement_attempts: z.array(z.object({ date: z.string(), method: z.string(), result: z.string() })),
  demand_letter_sent: z.string().describe("yes / no, או \"\" אם לא ידוע"),
  demand_letter_date: z.string(),
  evidence: z.array(z.object({ description: z.string(), in_possession: z.string().describe("yes / no / \"\"") })),
});
export type ModelCaseFile = z.infer<typeof ModelCaseFileSchema>;

const s = (v: string | null | undefined) => v ?? "";
const n = (v: string) => (v.trim() === "" ? null : v.trim());
const yn = (v: string): boolean | null => (/^(yes|true|כן)$/i.test(v.trim()) ? true : /^(no|false|לא)$/i.test(v.trim()) ? false : null);
const ynOut = (v: boolean | null) => (v == null ? "" : v ? "yes" : "no");

const CASE_TYPES = ["consumer_purchase", "rental_deposit", "services", "damages", "other"] as const;
const ENTITY_TYPES = ["company", "licensed_dealer", "individual", "unknown"] as const;
const oneOf = <T extends string>(list: readonly T[], v: string): T | null => (list as readonly string[]).includes(v.trim()) ? (v.trim() as T) : null;

export function toModel(c: CaseFile): ModelCaseFile {
  return {
    case_type: s(c.case_type),
    plaintiff_full_name: s(c.plaintiff.full_name),
    plaintiff_id_number: s(c.plaintiff.id_number),
    plaintiff_address: s(c.plaintiff.address),
    plaintiff_phone: s(c.plaintiff.phone),
    defendant_name: s(c.defendant.name),
    defendant_entity_type: s(c.defendant.entity_type),
    defendant_registration_number: s(c.defendant.registration_number),
    defendant_address: s(c.defendant.address),
    incident_date: s(c.incident_date),
    timeline: c.timeline.map((t) => ({ date: s(t.date), description: t.description })),
    facts: c.facts,
    amount_total: c.amount.total ?? 0,
    amount_breakdown: c.amount.breakdown,
    settlement_attempts: c.settlement.attempts.map((a) => ({ date: s(a.date), method: a.method, result: s(a.result) })),
    demand_letter_sent: ynOut(c.settlement.demand_letter_sent),
    demand_letter_date: s(c.settlement.demand_letter_date),
    evidence: c.evidence.map((e) => ({ description: e.description, in_possession: ynOut(e.in_possession) })),
  };
}

export function fromModel(m: ModelCaseFile): CaseFile {
  return {
    case_type: oneOf(CASE_TYPES, m.case_type),
    plaintiff: {
      full_name: n(m.plaintiff_full_name),
      id_number: n(m.plaintiff_id_number),
      address: n(m.plaintiff_address),
      phone: n(m.plaintiff_phone),
    },
    defendant: {
      name: n(m.defendant_name),
      entity_type: oneOf(ENTITY_TYPES, m.defendant_entity_type),
      registration_number: n(m.defendant_registration_number),
      address: n(m.defendant_address),
    },
    incident_date: n(m.incident_date),
    timeline: m.timeline.filter((t) => t.description.trim()).map((t) => ({ date: n(t.date), description: t.description })),
    facts: m.facts.filter((f) => f.trim()),
    amount: {
      total: m.amount_total > 0 ? m.amount_total : null,
      breakdown: m.amount_breakdown.filter((b) => b.item.trim() && b.amount > 0),
    },
    settlement: {
      attempts: m.settlement_attempts.filter((a) => a.method.trim()).map((a) => ({ date: n(a.date), method: a.method, result: n(a.result) })),
      demand_letter_sent: yn(m.demand_letter_sent),
      demand_letter_date: n(m.demand_letter_date),
    },
    evidence: m.evidence.filter((e) => e.description.trim()).map((e) => ({ description: e.description, in_possession: yn(e.in_possession) })),
  };
}
