"use client";
import type { FieldStatusRow } from "@/lib/fields";
import type { ValidationResult } from "@/lib/validate";

const ICON = { filled: "✓", missing: "", unknown: "?" } as const;

export function CasePanel({
  fields,
  validation,
  onDraft,
  drafting,
}: {
  fields: FieldStatusRow[];
  validation: ValidationResult;
  onDraft: () => void;
  drafting: boolean;
}) {
  const groups = Array.from(new Set(fields.map((f) => f.group)));
  const shownIssues = validation.issues.filter((i) => i.code !== "core_missing");
  const missingLabels = fields.filter((f) => f.required && f.status === "missing").map((f) => f.label);

  return (
    <aside className="card" aria-label="תיק התביעה">
      <div className="card-head">
        <h2>תיק התביעה</h2>
        <span className="hint">{validation.completeness}% הושלם</span>
      </div>
      <div style={{ padding: "10px 16px 0" }}>
        <div className="progress" role="progressbar" aria-valuenow={validation.completeness} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${validation.completeness}%` }} />
        </div>
      </div>
      <div className="panel-body">
        {groups.map((g) => (
          <section key={g}>
            <div className="group-title">{g}</div>
            {fields.filter((f) => f.group === g).map((f) => (
              <div className="field" key={f.key}>
                <span className={`dot ${f.status}`} aria-label={f.status === "filled" ? "מולא" : f.status === "unknown" ? "לא ידוע" : "חסר"}>
                  {ICON[f.status]}
                </span>
                <div>
                  <div className="label">
                    {f.label}
                    {!f.required && <span className="hint"> (רשות)</span>}
                  </div>
                  {f.status === "filled" && <div className="value">{f.value}</div>}
                  {f.status === "unknown" && <div className="tag">לא ידוע — יסומן [להשלמה]</div>}
                  {f.status === "missing" && <div className="value">חסר</div>}
                </div>
              </div>
            ))}
          </section>
        ))}
        {shownIssues.length > 0 && (
          <>
            <div className="group-title">בדיקות אוטומטיות</div>
            <ul className="issues">
              {shownIssues.map((i) => (
                <li key={i.code} className={i.severity}>{i.message.split(/(https?:\/\/\S+[^\s,.)])/g).map((p, k) => (/^https?:/.test(p) ? <a key={k} href={p} target="_blank" rel="noreferrer" dir="ltr">{p}</a> : p))}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="panel-foot">
        <button className="btn primary block" onClick={onDraft} disabled={!validation.canDraft || drafting}>
          {drafting ? "יוצר טיוטה…" : "יצירת טיוטה"}
        </button>
        {!validation.canDraft && (
          <div className="hint">
            {validation.issues.some((i) => i.severity === "blocker" && i.code !== "core_missing")
              ? "יש לטפל בבעיה החוסמת שלמעלה לפני יצירת הטיוטה."
              : `עוד ${missingLabels.length} שדות חובה חסרים. אפשר לענות "לא יודע" — השדה יסומן להשלמה.`}
          </div>
        )}
      </div>
    </aside>
  );
}
