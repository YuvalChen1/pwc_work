"use client";
import { useEffect } from "react";
import type { FieldStatusRow } from "@/lib/fields";
import type { CaseFile } from "@/lib/schema";

/** "2026-09-14" → "14.09.2026", "2026-09" → "09/2026"; anything else as is. */
function fmtDate(s: string) {
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return `${full[3]}.${full[2]}.${full[1]}`;
  const month = s.match(/^(\d{4})-(\d{2})$/);
  return month ? `${month[2]}/${month[1]}` : s;
}

/**
 * The last step before drafting: the user sees everything the draft will be written from
 * and confirms it. The drafting model gets only the case file, never the chat, so this is
 * exactly what can appear in the draft.
 */
export function ConfirmDraft({
  caseFile,
  fields,
  onConfirm,
  onCancel,
}: {
  caseFile: CaseFile;
  fields: FieldStatusRow[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const rows = fields.filter((f) => f.key !== "facts" && (f.required || f.status === "filled"));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title">לפני יצירת הטיוטה: האם הפרטים נכונים?</h2>
        <p className="hint">הטיוטה תיכתב רק מהפרטים שכאן, לא מהשיחה. מה שמסומן [להשלמה] יישאר בטיוטה כמקום ריק להשלמה ידנית.</p>

        <div className="group-title">מה קרה</div>
        <ol className="confirm-facts">
          {caseFile.facts.map((f, i) => <li key={i}>{f}</li>)}
        </ol>

        <dl className="confirm-list">
          {rows.map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd className={f.status === "filled" ? "" : "pending"}>
                {f.status === "filled" ? (f.key === "incident_date" && f.value ? fmtDate(f.value) : f.value) : "[להשלמה]"}
              </dd>
            </div>
          ))}
        </dl>

        <div className="confirm-actions">
          <button className="btn primary" onClick={onConfirm}>הפרטים נכונים, ליצור טיוטה</button>
          <button className="btn" onClick={onCancel}>יש מה לתקן</button>
        </div>
        <p className="hint">כדי לתקן, כתבו בשיחה מה לא מדויק, והתיק יתעדכן.</p>
      </div>
    </div>
  );
}
