"use client";
import { Children, isValidElement, cloneElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { DraftResult } from "@/lib/pipeline";
import { DISCLAIMER } from "@/lib/config";

const CATEGORY: Record<string, string> = {
  unsupported_fact: "עובדה שלא נמסרה",
  amount_mismatch: "סכום",
  date_mismatch: "תאריך",
  missing_attachment: "נספחים",
  missing_placeholder: "פרט חסר",
  structure: "מבנה",
  hebrew_quality: "עברית",
  legal_overreach: "ניסוח משפטי",
};
const SEVERITY: Record<string, string> = { high: "חמור", medium: "בינוני", low: "קל" };

/** Highlights [להשלמה: …] placeholders inside rendered text. */
function highlight(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return child.split(/(\[להשלמה[^\]]*\])/g).map((part, i) =>
        part.startsWith("[להשלמה") ? <mark key={i} className="placeholder">{part}</mark> : part,
      );
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
      return cloneElement(child, undefined, highlight(child.props.children));
    }
    return child;
  });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function IssueList({ items }: { items: DraftResult["findings"] }) {
  return (
    <>
      {items.map((i, idx) => (
        <div className="qa-item" key={idx}>
          <div className="meta">
            <span className={`badge ${i.severity}`}>{SEVERITY[i.severity]}</span>
            <span className="badge">{CATEGORY[i.category] ?? i.category}</span>
            <span className="badge">{i.source === "code" ? "בדיקת קוד" : "מבקר AI"}</span>
          </div>
          {i.quote && <q>”{i.quote}“</q>}
          <div>{i.explanation}</div>
        </div>
      ))}
    </>
  );
}

export function DraftView({ result, onBack }: { result: DraftResult; onBack: () => void }) {
  const placeholders = (result.draft.match(/\[להשלמה[^\]]*\]/g) ?? []).length;
  const exportDocx = async () => {
    const res = await fetch("/api/export/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: result.draft }),
    });
    if (res.ok) download(await res.blob(), "טיוטת-כתב-תביעה.docx");
  };
  const exportMd = () =>
    download(new Blob([`> **טיוטה** — ${DISCLAIMER}\n\n${result.draft}\n`], { type: "text/markdown;charset=utf-8" }), "טיוטת-כתב-תביעה.md");

  const components = {
    p: ({ children }: { children?: ReactNode }) => <p>{highlight(children)}</p>,
    li: ({ children }: { children?: ReactNode }) => <li>{highlight(children)}</li>,
    h1: ({ children }: { children?: ReactNode }) => <h1>{highlight(children)}</h1>,
  };

  return (
    <div className="draft-layout">
      <section className="card" aria-label="הטיוטה">
        <div className="card-head">
          <h2>טיוטת כתב התביעה</h2>
          <div className="export-row">
            <button className="btn" onClick={onBack}>חזרה לשיחה</button>
            <button className="btn" onClick={exportMd}>ייצוא Markdown</button>
            <button className="btn primary" onClick={exportDocx}>ייצוא DOCX</button>
          </div>
        </div>
        <div className="doc-scroll">
          <article className="doc">
            <ReactMarkdown components={components}>{result.draft}</ReactMarkdown>
          </article>
        </div>
      </section>

      <aside className="card" aria-label="בקרת איכות">
        <div className="card-head">
          <h2>בקרת איכות</h2>
          <span className={`badge ${result.remaining.length ? "medium" : "ok"}`}>
            {result.remaining.length ? `${result.remaining.length} הערות פתוחות` : "עבר בדיקה"}
          </span>
        </div>
        <div className="panel-body">
          <p className="hint">
            הטיוטה נבדקה מול תיק התביעה בבדיקות קוד ובקריאה נפרדת של מודל-מבקר.
            {result.revised ? ` נמצאו ${result.findings.length} ממצאים בטיוטה הראשונה והם תוקנו אוטומטית.` : " לא נמצאו ממצאים."}
          </p>
          {placeholders > 0 && (
            <p className="hint">
              בטיוטה <mark className="placeholder">{placeholders} פרטים להשלמה</mark> — יש למלא אותם לפני ההגשה.
            </p>
          )}
          {result.remaining.length > 0 && (
            <>
              <div className="group-title">הערות שנותרו לבדיקתך</div>
              <p className="hint">{result.remainingSummary}</p>
              <IssueList items={result.remaining} />
            </>
          )}
          {result.findings.length > 0 && (
            <details>
              <summary>ממצאי הבדיקה הראשונה ({result.findings.length}) — תוקנו</summary>
              <p className="hint">{result.criticSummary}</p>
              <IssueList items={result.findings} />
            </details>
          )}
          <div className="group-title">לפני הגשה</div>
          <p className="hint">{DISCLAIMER}</p>
        </div>
      </aside>
    </div>
  );
}
