/**
 * Deterministic checks of the code-side validation (no API calls).
 * Run: npm run test:unit
 */
import assert from "node:assert/strict";
import { SMALL_CLAIMS_CEILING_ILS } from "../lib/config";
import { checkDraft } from "../lib/draftChecks";
import { mergeCaseFile } from "../lib/merge";
import { emptyCaseFile, type CaseFile } from "../lib/schema";
import { isValidIsraeliId, parseLooseDate, validateCase } from "../lib/validate";

const TODAY = "2026-11-03";
let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}\n  ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

function base(): CaseFile {
  const c = emptyCaseFile();
  c.facts = ["קניתי מזגן"];
  c.defendant.name = "חשמל פלוס בע\"מ";
  c.amount.total = 3200;
  return c;
}
const codes = (c: CaseFile) => validateCase(c, [], TODAY).issues.map((i) => i.code);

test("Israeli ID check digit", () => {
  assert.equal(isValidIsraeliId("123456782"), true);
  assert.equal(isValidIsraeliId("123456789"), false);
});

test("partial dates resolve to the latest possible day", () => {
  assert.equal(parseLooseDate("2025-02")?.toISOString().slice(0, 10), "2025-02-28");
  assert.equal(parseLooseDate("2019")?.toISOString().slice(0, 10), "2019-12-31");
  assert.equal(parseLooseDate("לא תאריך"), null);
});

test("amount above the ceiling is a blocker", () => {
  const c = base();
  c.amount.total = SMALL_CLAIMS_CEILING_ILS + 1;
  const v = validateCase(c, [], TODAY);
  assert.ok(v.issues.some((i) => i.code === "amount_over_ceiling" && i.severity === "blocker"));
  assert.equal(v.canDraft, false);
});

test("amount exactly at the ceiling is allowed", () => {
  const c = base();
  c.amount.total = SMALL_CLAIMS_CEILING_ILS;
  assert.ok(!codes(c).includes("amount_over_ceiling"));
});

test("statute of limitations: >7 years warns, 6–7 years warns softly, recent is fine", () => {
  const c = base();
  c.incident_date = "2018-05-01";
  assert.ok(codes(c).includes("limitation_expired"));
  c.incident_date = "2020-03-01";
  assert.ok(codes(c).includes("limitation_near"));
  c.incident_date = "2026-09-14";
  assert.ok(!codes(c).some((x) => x.startsWith("limitation")));
});

test("future date is flagged", () => {
  const c = base();
  c.incident_date = "2027-01-01";
  assert.ok(codes(c).includes("date_in_future"));
});

test("breakdown that does not add up is flagged", () => {
  const c = base();
  c.amount.breakdown = [{ item: "מזגן", amount: 3000 }];
  assert.ok(codes(c).includes("amount_breakdown_mismatch"));
});

test("company without registration number → registrar hint; no demand letter → recommendation", () => {
  const c = base();
  c.defendant.entity_type = "company";
  c.settlement.demand_letter_sent = false;
  const cs = codes(c);
  assert.ok(cs.includes("defendant_no_registration"));
  assert.ok(cs.includes("no_demand_letter"));
});

test("draft is allowed only when every required field is filled or marked unknown", () => {
  const c = base();
  assert.equal(validateCase(c, [], TODAY).canDraft, false);
  const allUnknown = [
    "plaintiff.full_name", "plaintiff.id_number", "plaintiff.address", "plaintiff.phone",
    "defendant.registration_number", "defendant.address", "incident_date", "amount.breakdown",
    "settlement.demand_letter_sent", "evidence",
  ] as const;
  assert.equal(validateCase(c, [...allUnknown], TODAY).canDraft, true);
});

test("core fields cannot be skipped by marking them unknown", () => {
  const c = base();
  c.amount.total = null;
  assert.equal(validateCase(c, ["amount.total"], TODAY).canDraft, false);
});

test("merge never loses data the model forgot to return", () => {
  const prev = base();
  prev.plaintiff.phone = "052-1234567";
  prev.facts = ["א", "ב", "ג"];
  const next = emptyCaseFile();
  next.facts = ["ד"];
  next.amount.total = 3000; // a correction overrides
  const m = mergeCaseFile(prev, next);
  assert.equal(m.plaintiff.phone, "052-1234567");
  assert.deepEqual(m.facts, ["א", "ב", "ג", "ד"]);
  assert.equal(m.amount.total, 3000);
});

test("draft checks catch invented amounts, dates and attachments", () => {
  const c = base();
  c.incident_date = "2026-09-14";
  c.evidence = [{ description: "קבלה", in_possession: true }];
  const draft = `# בבית משפט לתביעות קטנות בתל אביב\nהתובע\n- נגד -\n## כתב תביעה\n**סכום התביעה:** 3,200 ₪\n## א. הצדדים\n## ב. הרקע העובדתי\n1. ביום 14.09.2026 רכש התובע מזגן (נספח א'). ביום 20.09.2026 התקלקל. (נספח ב')\n## ג. פניות\n## ד. עילות\n## ה. הסעד\n1. 3,200 ₪ ועוד 500 ₪ עוגמת נפש\n## ו. רשימת נספחים\nנספח א' — קבלה\n## ז. הצהרה וחתימה`;
  const issues = checkDraft(draft, c);
  assert.ok(issues.some((i) => i.category === "amount_mismatch" && i.quote.includes("500")));
  assert.ok(issues.some((i) => i.category === "date_mismatch" && i.quote === "20.09.2026"));
  assert.ok(!issues.some((i) => i.quote === "14.09.2026"));
  assert.ok(issues.some((i) => i.category === "missing_attachment" && i.quote.includes("ב")));
  assert.ok(!issues.some((i) => i.category === "structure"));
});

console.log(`\n${passed} passed`);
