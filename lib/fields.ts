import type { CaseFile, FieldKey } from "./schema";

export type FieldStatus = "filled" | "missing" | "unknown";

export type FieldDef = {
  key: FieldKey;
  label: string;
  group: string;
  /** Required = the draft cannot be generated until it is filled or explicitly marked unknown. */
  required: boolean;
  /** The field's value for display, or null when empty. */
  display: (c: CaseFile) => string | null;
};

const fmtAmount = (n: number) => `${n.toLocaleString("he-IL")} ₪`;

/** Order = order of importance; also the order the panel shows them. */
export const FIELD_DEFS: FieldDef[] = [
  { key: "facts", label: "עובדות המקרה", group: "המקרה", required: true,
    display: (c) => (c.facts.length ? `${c.facts.length} עובדות` : null) },
  { key: "defendant.name", label: "שם הנתבע", group: "הנתבע", required: true,
    display: (c) => c.defendant.name },
  { key: "amount.total", label: "סכום התביעה", group: "הסכום", required: true,
    display: (c) => (c.amount.total != null ? fmtAmount(c.amount.total) : null) },
  { key: "incident_date", label: "תאריך האירוע", group: "המקרה", required: true,
    display: (c) => c.incident_date },
  { key: "plaintiff.full_name", label: "שם התובע", group: "התובע", required: true,
    display: (c) => c.plaintiff.full_name },
  { key: "plaintiff.id_number", label: "ת.ז. התובע", group: "התובע", required: true,
    display: (c) => c.plaintiff.id_number },
  { key: "plaintiff.address", label: "כתובת התובע", group: "התובע", required: true,
    display: (c) => c.plaintiff.address },
  { key: "plaintiff.phone", label: "טלפון התובע", group: "התובע", required: true,
    display: (c) => c.plaintiff.phone },
  { key: "defendant.registration_number", label: "ח.פ. / ת.ז. הנתבע", group: "הנתבע", required: true,
    display: (c) => c.defendant.registration_number },
  { key: "defendant.address", label: "כתובת הנתבע", group: "הנתבע", required: true,
    display: (c) => c.defendant.address },
  { key: "amount.breakdown", label: "פירוט הסכום", group: "הסכום", required: true,
    display: (c) => (c.amount.breakdown.length ? c.amount.breakdown.map((b) => `${b.item}: ${fmtAmount(b.amount)}`).join(" · ") : null) },
  { key: "settlement.attempts", label: "ניסיונות יישוב", group: "יישוב הסכסוך", required: false,
    display: (c) => (c.settlement.attempts.length ? `${c.settlement.attempts.length} פניות` : null) },
  { key: "settlement.demand_letter_sent", label: "מכתב התראה", group: "יישוב הסכסוך", required: true,
    display: (c) => (c.settlement.demand_letter_sent == null ? null : c.settlement.demand_letter_sent ? `נשלח${c.settlement.demand_letter_date ? ` (${c.settlement.demand_letter_date})` : ""}` : "לא נשלח") },
  { key: "evidence", label: "ראיות ומסמכים", group: "ראיות", required: true,
    display: (c) => (c.evidence.length ? c.evidence.map((e) => e.description).join(", ") : null) },
];

export function fieldStatus(def: FieldDef, c: CaseFile, unknown: FieldKey[]): FieldStatus {
  if (def.display(c) != null) return "filled";
  return unknown.includes(def.key) ? "unknown" : "missing";
}

export function computeFieldStatuses(c: CaseFile, unknown: FieldKey[]) {
  return FIELD_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    group: def.group,
    required: def.required,
    value: def.display(c),
    status: fieldStatus(def, c, unknown),
  }));
}
export type FieldStatusRow = ReturnType<typeof computeFieldStatuses>[number];
