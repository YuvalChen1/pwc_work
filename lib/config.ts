/**
 * Central configuration. Everything that is likely to change lives here.
 */

/**
 * The single place where the model is chosen.
 * - Development: set CLAUDE_MODEL=claude-sonnet-5-5 in .env.local (faster, cheaper).
 * - Final version: claude-opus-5-5 (the default).
 */
export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

/** Effort per pipeline stage (Claude adaptive thinking depth). */
export const EFFORT = {
  interview: "low",
  draft: "high",
  critic: "high",
  revise: "medium",
} as const;

/**
 * תקרת הסכום בבית משפט לתביעות קטנות (בש"ח).
 * ⚠️ מתעדכנת מדי שנה ב-1 בינואר לפי מדד המחירים לצרכן.
 * 39,900 ₪ — הסכום התקף מ-1.1.2026 (הודעת הנהלת בתי המשפט / משרד המשפטים).
 * יש לעדכן ערך זה בתחילת כל שנה.
 */
export const SMALL_CLAIMS_CEILING_ILS = 39_900;
export const SMALL_CLAIMS_CEILING_YEAR = 2026;

/** תקופת ההתיישנות בתביעה אזרחית שאינה במקרקעין (חוק ההתיישנות, תשי"ח-1958, סעיף 5). */
export const LIMITATION_YEARS = 7;
/** מתחילים להזהיר כשנשארה פחות משנה עד ההתיישנות. */
export const LIMITATION_WARNING_YEARS = 6;

/** Max number of user turns before the agent pushes to wrap up. */
export const MAX_INTERVIEW_TURNS = 25;

export const DISCLAIMER =
  "המסמך הוא טיוטה שנוצרה באופן אוטומטי לצורך עזרה עצמית, ואינו מהווה ייעוץ משפטי. מומלץ לבדוק את הטיוטה, להשלים את הפרטים המסומנים ולהתייעץ עם עורך דין או עם הלשכה לסיוע משפטי לפני הגשה.";

export const COMPANIES_REGISTRAR_URL = "https://ica.justice.gov.il";

/** Today's date in Israel, YYYY-MM-DD. Injected into prompts so the model can resolve "לפני שבועיים". */
export function todayInIsrael(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The production deployment — used for the QR code in the README (scripts/make-qr.ts). */
export const PUBLIC_APP_URL = "https://pwcwork-six.vercel.app";
