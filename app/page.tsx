"use client";
import { useEffect, useRef, useState } from "react";
import { CasePanel } from "@/components/CasePanel";
import { DraftView } from "@/components/DraftView";
import { QrButton } from "@/components/QrButton";
import { VoiceMode } from "@/components/VoiceMode";
import { DISCLAIMER, todayInIsrael } from "@/lib/config";
import { computeFieldStatuses } from "@/lib/fields";
import type { DraftResult, InterviewResult } from "@/lib/pipeline";
import { emptyCaseFile, type CaseFile, type ChatMessage, type FieldKey } from "@/lib/schema";
import { clearSession, loadSession, saveSession, type ChatItem } from "@/lib/session";
import { unlockSpeech, voiceSupported } from "@/lib/speech";
import { validateCase } from "@/lib/validate";

const GREETING =
  "שלום! אני אעזור לך להכין טיוטת כתב תביעה לבית המשפט לתביעות קטנות. אשאל כמה שאלות קצרות, אחת-שתיים בכל פעם, ובסוף אנסח טיוטה שתוכל/י לבדוק ולהשלים.\n\nספר/י לי בקצרה: מה קרה ומול מי?";

/** Renders URLs as LTR links so they don't scramble inside right-to-left text. */
function Linkify({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s,)]+[^\s,.)])/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" dir="ltr">{part}</a>
        ) : (
          part
        ),
      )}
    </>
  );
}

const SEVERITY_LABEL = { blocker: "חוסם", warning: "אזהרה", info: "המלצה" } as const;
const DRAFT_STEPS = ["מנסח את כתב התביעה", "בקרת איכות: בודק מול תיק התביעה", "מתקן את הממצאים", "בדיקה חוזרת"];

export default function Home() {
  const [items, setItems] = useState<ChatItem[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseFile, setCaseFile] = useState<CaseFile>(emptyCaseFile());
  const [unknownFields, setUnknownFields] = useState<FieldKey[]>([]);
  const [raisedIssueCodes, setRaisedIssueCodes] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draftStep, setDraftStep] = useState(0);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [view, setView] = useState<"chat" | "draft">("chat");
  const [restored, setRestored] = useState(false);
  // State, not a ref: saving must start only on the render *after* the restore has been applied.
  const [hydrated, setHydrated] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [canVoice, setCanVoice] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Restore a saved session once, after mount (localStorage doesn't exist during server rendering).
  useEffect(() => {
    const s = loadSession();
    if (s) {
      let restoredItems = s.items;
      let restoredInput = s.input;
      // The page was closed while waiting for a reply: put the unanswered message back in the box.
      const last = restoredItems[restoredItems.length - 1];
      if (last.role === "user") {
        restoredItems = restoredItems.slice(0, -1);
        restoredInput = restoredInput || last.content;
      }
      setItems(restoredItems);
      setInput(restoredInput);
      setCaseFile(s.caseFile);
      setUnknownFields(s.unknownFields);
      setRaisedIssueCodes(s.raisedIssueCodes);
      setDraft(s.draft);
      setRestored(restoredItems.length > 1 || !!s.draft);
    }
    setHydrated(true);
    setCanVoice(voiceSupported());
  }, []);

  // Save on every change. A pristine session (greeting only, nothing typed) isn't worth keeping.
  useEffect(() => {
    if (!hydrated) return;
    if (items.length <= 1 && !input && !draft) return clearSession();
    saveSession({ items, input, caseFile, unknownFields, raisedIssueCodes, draft });
  }, [hydrated, items, input, caseFile, unknownFields, raisedIssueCodes, draft]);

  function startOver() {
    if (!window.confirm("להתחיל מחדש? השיחה, תיק התביעה והטיוטה יימחקו מהדפדפן.")) return;
    clearSession();
    setItems([{ role: "assistant", content: GREETING }]);
    setInput("");
    setError(null);
    setCaseFile(emptyCaseFile());
    setUnknownFields([]);
    setRaisedIssueCodes([]);
    setDraft(null);
    setView("chat");
    setRestored(false);
    setVoiceMode(false);
  }

  const lastAssistant = [...items].reverse().find((m): m is ChatMessage => m.role === "assistant")?.content ?? null;
  const validation = validateCase(caseFile, unknownFields, todayInIsrael());
  const fields = computeFieldStatuses(caseFile, unknownFields);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, busy]);

  /** Runs one interview turn. Resolves to the agent's reply, or null on error (shown in the chat). */
  async function submit(text: string, voice = false): Promise<string | null> {
    if (!text || busy) return null;
    const next: ChatItem[] = [...items, { role: "user", content: text }];
    setItems(next);
    setBusy(true);
    setError(null);
    try {
      const messages = next.filter((m): m is ChatMessage => m.role !== "notice");
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, caseFile, unknownFields, raisedIssueCodes, voice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      const r = data as InterviewResult;
      setCaseFile(r.caseFile);
      setUnknownFields(r.unknownFields);
      setRaisedIssueCodes(r.raisedIssueCodes);
      setItems((cur) => [
        ...cur,
        ...r.notices.map((issue) => ({ role: "notice" as const, issue })),
        { role: "assistant", content: r.assistantMessage },
      ]);
      return r.assistantMessage;
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
      setItems((cur) => cur.slice(0, -1));
      if (!voice) setInput(text);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    submit(text);
  }

  function enterVoice() {
    unlockSpeech(); // must run inside the click, for iOS
    setVoiceMode(true);
  }

  async function makeDraft() {
    setDrafting(true);
    setError(null);
    setDraftStep(0);
    setVoiceMode(false);
    setView("draft");
    // The server runs the four stages in one request; advance the indicator on a timer.
    const timer = setInterval(() => setDraftStep((s) => Math.min(s + 1, DRAFT_STEPS.length - 1)), 25_000);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseFile, unknownFields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה");
      setDraft(data as DraftResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
      setView("chat");
    } finally {
      clearInterval(timer);
      setDrafting(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>טיוטת כתב תביעה — תביעות קטנות</h1>
          <div className="sub">ראיון קצר ← בדיקות אוטומטיות ← טיוטה ← בקרת איכות</div>
        </div>
        <div className="topbar-actions">
          {draft && view === "chat" && <button className="btn" onClick={() => setView("draft")}>לטיוטה</button>}
          {(items.length > 1 || draft) && !busy && !drafting && (
            <button className="btn" onClick={startOver}>התחלה מחדש</button>
          )}
          <QrButton />
        </div>
      </header>
      <div className="disclaimer" role="note">⚠️ {DISCLAIMER}</div>
      {restored && (
        <div className="restored" role="status">
          <span>המשכנו מאיפה שהפסקת. השיחה נשמרת בדפדפן הזה בלבד, ל-7 ימים.</span>
          <button className="link-btn" onClick={() => setRestored(false)} aria-label="סגירת ההודעה">✕</button>
        </div>
      )}

      {view === "draft" && draft && !drafting ? (
        <DraftView result={draft} onBack={() => setView("chat")} />
      ) : view === "draft" && drafting ? (
        <div className="center-box">
          <div>
            <h2 style={{ margin: 0 }}>מכין את הטיוטה…</h2>
            <p className="hint">התהליך כולל ניסוח, בדיקה ותיקון, ועשוי להימשך כשתיים-שלוש דקות.</p>
            <ul className="loading-steps">
              {DRAFT_STEPS.map((s, i) => (
                <li key={s} className={i < draftStep ? "done" : i === draftStep ? "active" : ""}>
                  {i < draftStep ? "✓ " : i === draftStep ? "● " : "○ "}
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <main className="main">
          <section className="card" aria-label="שיחה">
            <div className="card-head"><h2>שיחה</h2></div>
            <div className="messages" aria-live="polite">
              {items.map((m, i) =>
                m.role === "notice" ? (
                  <div key={i} className={`notice ${m.issue.severity}`}>
                    <b>בדיקה אוטומטית · {SEVERITY_LABEL[m.issue.severity]}</b>
                    <Linkify text={m.issue.message} />
                  </div>
                ) : (
                  <div key={i} className={`msg ${m.role}`}><Linkify text={m.content} /></div>
                ),
              )}
              {busy && <div className="typing">מקליד…</div>}
              <div ref={endRef} />
            </div>
            {error && <div className="error" style={{ padding: "0 16px" }}>{error}</div>}
            {voiceMode ? (
              <VoiceMode
                greeting={lastAssistant}
                onUtterance={(text) => submit(text, true)}
                onExit={() => setVoiceMode(false)}
              />
            ) : (
              <div className="composer">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="כתבו כאן…"
                  title="Enter לשליחה, Shift+Enter לשורה חדשה"
                  rows={1}
                  disabled={busy}
                  aria-label="הודעה"
                />
                {canVoice && (
                  <button className="btn mic" onClick={enterVoice} disabled={busy} title="שיחה קולית" aria-label="מעבר לשיחה קולית">
                    <img src="/mic.png" alt="" width={24} height={24} />
                  </button>
                )}
                <button className="btn primary" onClick={send} disabled={busy || !input.trim()}>שליחה</button>
              </div>
            )}
          </section>
          <CasePanel fields={fields} validation={validation} onDraft={makeDraft} drafting={drafting} />
        </main>
      )}
    </div>
  );
}
