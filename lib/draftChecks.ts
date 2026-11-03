/**
 * Deterministic checks on the generated draft. They complement the LLM critic:
 * the critic catches meaning-level problems, these catch exact-match problems with certainty.
 */
import type { CaseFile, Critique } from "./schema";

export type DraftIssue = Critique["issues"][number] & { source: "code" | "critic" };

const REQUIRED_SECTIONS: [RegExp, string][] = [
  [/^#\s*בבית משפט לתביעות קטנות/m, "כותרת בית המשפט"],
  [/התובע/, "פרטי התובע"],
  [/-\s*נגד\s*-/, "\"- נגד -\""],
  [/^##\s*כתב תביעה/m, "כותרת \"כתב תביעה\""],
  [/^##\s*א\.\s/m, "פרק א. הצדדים"],
  [/^##\s*ב\.\s/m, "פרק ב. הרקע העובדתי"],
  [/^##\s*ג\.\s/m, "פרק ג. פניות וניסיונות יישוב"],
  [/^##\s*ד\.\s/m, "פרק ד. עילות התביעה"],
  [/^##\s*ה\.\s/m, "פרק ה. הסעד המבוקש"],
  [/^##\s*ו\.\s/m, "פרק ו. רשימת נספחים"],
  [/^##\s*ז\.\s/m, "פרק ז. הצהרה וחתימה"],
];

function toIso(d: string, m: string, y: string) {
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function caseDates(c: CaseFile): Set<string> {
  const all = [
    c.incident_date,
    c.settlement.demand_letter_date,
    ...c.timeline.map((t) => t.date),
    ...c.settlement.attempts.map((a) => a.date),
  ].filter((d): d is string => !!d);
  return new Set(all);
}

function caseAmounts(c: CaseFile): Set<number> {
  const s = new Set<number>();
  if (c.amount.total != null) s.add(c.amount.total);
  for (const b of c.amount.breakdown) s.add(b.amount);
  return s;
}

export function checkDraft(draft: string, c: CaseFile): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const add = (i: Omit<DraftIssue, "source">) => issues.push({ ...i, source: "code" });

  // 1. Every amount in the draft must exist in the case file.
  const amounts = caseAmounts(c);
  const amountRe = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:₪|ש"ח|ש״ח|שקלים|שקל)/g;
  for (const m of draft.matchAll(amountRe)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!amounts.has(n)) {
      add({ category: "amount_mismatch", severity: "high", quote: m[0], explanation: `הסכום ${m[0]} אינו מופיע בתיק התביעה (סכומים בתיק: ${[...amounts].join(", ") || "אין"}).`, suggested_fix: "להחליף בסכום מתוך התיק או למחוק." });
    }
  }
  if (c.amount.total != null && !draft.includes(c.amount.total.toLocaleString("en-US"))) {
    add({ category: "amount_mismatch", severity: "high", quote: "", explanation: `סכום התביעה הכולל (${c.amount.total.toLocaleString("en-US")} ₪) אינו מופיע בטיוטה.`, suggested_fix: "לציין את סכום התביעה בכותרת ובסעד המבוקש." });
  }

  // 2. Every full date in the draft must exist in the case file.
  const dates = caseDates(c);
  const dateRe = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g;
  for (const m of draft.matchAll(dateRe)) {
    const iso = toIso(m[1], m[2], m[3]);
    if (!dates.has(iso)) {
      add({ category: "date_mismatch", severity: "high", quote: m[0], explanation: `התאריך ${m[0]} אינו מופיע בתיק התביעה.`, suggested_fix: "להחליף בתאריך מתוך התיק או ב-[להשלמה: תאריך]." });
    }
  }

  // 3. Attachments: references in the body vs. the list, and the list vs. the evidence.
  const listStart = draft.search(/^##\s*ו\.\s/m);
  const body = listStart >= 0 ? draft.slice(0, listStart) : draft;
  const listPart = listStart >= 0 ? draft.slice(listStart).split(/^##\s*ז\.\s/m)[0] : "";
  const annexRe = /נספח\s+([א-ת])['׳]/g;
  const referenced = new Set([...body.matchAll(annexRe)].map((m) => m[1]));
  const listed = new Set([...listPart.matchAll(annexRe)].map((m) => m[1]));
  for (const r of referenced) {
    if (!listed.has(r)) add({ category: "missing_attachment", severity: "medium", quote: `נספח ${r}'`, explanation: `נספח ${r}' מוזכר בגוף הטיוטה אך אינו מופיע ברשימת הנספחים.`, suggested_fix: "להוסיף לרשימה (אם קיים בתיק) או להסיר את ההפניה." });
  }
  if (listed.size > c.evidence.length) {
    add({ category: "missing_attachment", severity: "medium", quote: "", explanation: `ברשימת הנספחים ${listed.size} נספחים, אך בתיק התביעה רק ${c.evidence.length} מסמכים.`, suggested_fix: "רשימת הנספחים חייבת לכלול רק מסמכים שבתיק." });
  }

  // 4. Required structure.
  for (const [re, name] of REQUIRED_SECTIONS) {
    if (!re.test(draft)) add({ category: "structure", severity: "medium", quote: "", explanation: `חסר חלק נדרש: ${name}.`, suggested_fix: `להוסיף את ${name} לפי המבנה המקובל.` });
  }

  // 5. Known identifiers must be copied exactly.
  if (c.plaintiff.id_number && !draft.includes(c.plaintiff.id_number)) {
    add({ category: "missing_placeholder", severity: "medium", quote: "", explanation: "מספר ת.ז. של התובע מהתיק אינו מופיע בטיוטה כפי שנמסר.", suggested_fix: `לציין ת.ז. ${c.plaintiff.id_number}.` });
  }
  if (c.defendant.registration_number && !draft.includes(c.defendant.registration_number)) {
    add({ category: "missing_placeholder", severity: "medium", quote: "", explanation: "מספר הזיהוי של הנתבע מהתיק אינו מופיע בטיוטה כפי שנמסר.", suggested_fix: `לציין ${c.defendant.registration_number}.` });
  }

  return issues;
}
