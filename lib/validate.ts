/**
 * Deterministic validation — done in code, never delegated to the model.
 * The model may misread a number or forget a rule; these checks cannot.
 */
import {
  COMPANIES_REGISTRAR_URL,
  LIMITATION_WARNING_YEARS,
  LIMITATION_YEARS,
  SMALL_CLAIMS_CEILING_ILS,
  SMALL_CLAIMS_CEILING_YEAR,
} from "./config";
import { FIELD_DEFS, fieldStatus } from "./fields";
import type { CaseFile, FieldKey } from "./schema";

export type Severity = "blocker" | "warning" | "info";
export type ValidationIssue = { code: string; severity: Severity; message: string };
export type ValidationResult = {
  issues: ValidationIssue[];
  canDraft: boolean;
  /** Required fields that are still neither filled nor marked unknown. */
  missingRequired: FieldKey[];
  completeness: number; // 0..100
};

/** Fields that cannot be left as [להשלמה] — without them there is no claim to write. */
const CORE_FIELDS: FieldKey[] = ["facts", "defendant.name", "amount.total"];

const fmt = (n: number) => `${n.toLocaleString("he-IL")} ₪`;

/** Israeli ID (ת.ז.) check digit — Luhn-like algorithm used by the Population Registry. */
export function isValidIsraeliId(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 9) return false;
  const id = digits.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(id[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

/** Parses "YYYY-MM-DD" / "YYYY-MM" / "YYYY". Partial dates resolve to the *latest* possible day,
 *  so the limitation check never wrongly declares a claim time-barred. */
export function parseLooseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 12;
  const d = m[3] ? Number(m[3]) : new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const date = new Date(Date.UTC(y, mo - 1, d));
  return isNaN(date.getTime()) ? null : date;
}

function yearsBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / (365.25 * 24 * 3600 * 1000);
}

export function validateCase(c: CaseFile, unknown: FieldKey[], today: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const now = parseLooseDate(today)!;

  // 1. Completeness
  const required = FIELD_DEFS.filter((f) => f.required);
  const statuses = required.map((f) => ({ key: f.key, status: fieldStatus(f, c, unknown) }));
  const missingRequired = statuses.filter((s) => s.status === "missing").map((s) => s.key);
  const filled = statuses.filter((s) => s.status === "filled").length;
  const completeness = Math.round((filled / required.length) * 100);

  for (const key of CORE_FIELDS) {
    const def = FIELD_DEFS.find((f) => f.key === key)!;
    if (def.display(c) == null) {
      issues.push({ code: "core_missing", severity: "blocker", message: `חסר שדה מהותי: ${def.label}. בלעדיו אי אפשר לנסח כתב תביעה.` });
    }
  }

  // 2. Amount vs. small-claims ceiling
  const total = c.amount.total;
  if (total != null) {
    if (total <= 0) {
      issues.push({ code: "amount_invalid", severity: "blocker", message: "סכום התביעה חייב להיות גדול מאפס." });
    } else if (total > SMALL_CLAIMS_CEILING_ILS) {
      issues.push({
        code: "amount_over_ceiling",
        severity: "blocker",
        message: `סכום התביעה (${fmt(total)}) עולה על תקרת בית המשפט לתביעות קטנות לשנת ${SMALL_CLAIMS_CEILING_YEAR} (${fmt(SMALL_CLAIMS_CEILING_ILS)}). אפשר להפחית את הסכום לתקרה ולוותר על ההפרש (ויתור סופי — לא ניתן לתבוע אותו בנפרד), או להגיש תביעה רגילה בבית משפט השלום.`,
      });
    }
    const sum = c.amount.breakdown.reduce((s, b) => s + b.amount, 0);
    if (c.amount.breakdown.length && Math.abs(sum - total) > 0.5) {
      issues.push({ code: "amount_breakdown_mismatch", severity: "warning", message: `סכום רכיבי הפירוט (${fmt(sum)}) אינו שווה לסכום התביעה (${fmt(total)}).` });
    }
  }

  // 3. Statute of limitations (7 years) — warning, not blocker: limitation is a defence the
  //    defendant must raise, and there are exceptions (e.g. late discovery, sec. 8 of the law).
  const incident = parseLooseDate(c.incident_date);
  if (c.incident_date && !incident) {
    issues.push({ code: "date_unparseable", severity: "warning", message: `תאריך האירוע "${c.incident_date}" אינו בפורמט תקין.` });
  }
  if (incident) {
    const years = yearsBetween(incident, now);
    if (years < 0) {
      issues.push({ code: "date_in_future", severity: "warning", message: `תאריך האירוע (${c.incident_date}) הוא בעתיד — כנראה טעות.` });
    } else if (years >= LIMITATION_YEARS) {
      issues.push({ code: "limitation_expired", severity: "warning", message: `חשש להתיישנות: עברו יותר מ-${LIMITATION_YEARS} שנים מתאריך האירוע (${c.incident_date}). הנתבע יוכל לבקש לדחות את התביעה. מומלץ להתייעץ עם עורך דין לפני הגשה.` });
    } else if (years >= LIMITATION_WARNING_YEARS) {
      issues.push({ code: "limitation_near", severity: "warning", message: `תקופת ההתיישנות (${LIMITATION_YEARS} שנים) מסתיימת בקרוב — מומלץ להגיש בהקדם.` });
    }
  }
  for (const ev of c.timeline) {
    const d = parseLooseDate(ev.date);
    if (d && d.getTime() > now.getTime()) {
      issues.push({ code: "timeline_future", severity: "warning", message: `התאריך ${ev.date} ("${ev.description}") הוא בעתיד.` });
    }
  }

  // 4. Identifiers
  if (c.plaintiff.id_number && !isValidIsraeliId(c.plaintiff.id_number)) {
    issues.push({ code: "plaintiff_id_invalid", severity: "warning", message: `מספר ת.ז. של התובע (${c.plaintiff.id_number}) אינו עובר בדיקת ספרת ביקורת. כדאי לבדוק שוב.` });
  }
  if (c.plaintiff.phone && !/^0\d{1,2}-?\d{7}$/.test(c.plaintiff.phone.replace(/[\s()]/g, ""))) {
    issues.push({ code: "phone_format", severity: "info", message: `מספר הטלפון (${c.plaintiff.phone}) אינו בפורמט ישראלי מוכר.` });
  }
  if (c.defendant.name && !c.defendant.registration_number && c.defendant.entity_type !== "individual") {
    issues.push({ code: "defendant_no_registration", severity: "info", message: `לא ידוע ח.פ. של הנתבע. אפשר לאתר אותו בחינם ברשם החברות (רשות התאגידים): ${COMPANIES_REGISTRAR_URL}, או לפי מספר העוסק שמופיע על הקבלה/החשבונית. חשוב לתבוע את הישות המשפטית הנכונה ולא רק את שם המותג.` });
  }

  // 5. Pre-litigation steps
  if (c.settlement.demand_letter_sent === false) {
    issues.push({ code: "no_demand_letter", severity: "info", message: "לא נשלח מכתב התראה. אין חובה חוקית, אך מומלץ לשלוח מכתב דרישה (במייל/בדואר רשום) ולתת 7–14 ימים לתגובה — זה מחזק את התביעה ולעיתים מייתר אותה." });
  }
  if (c.evidence.length && c.evidence.every((e) => e.in_possession === false)) {
    issues.push({ code: "no_evidence_in_hand", severity: "warning", message: "אף אחד מהמסמכים אינו בידיך כרגע. כדאי לנסות להשיג העתקים (למשל פירוט חיוב בכרטיס האשראי במקום קבלה)." });
  }

  const blockers = issues.some((i) => i.severity === "blocker");
  return { issues, canDraft: !blockers && missingRequired.length === 0, missingRequired, completeness };
}
