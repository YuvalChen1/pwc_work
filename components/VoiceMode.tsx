"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRecognition, hebrewVoice, splitForSpeech, toSpeakable, type Recognition } from "@/lib/speech";

type Phase = "idle" | "listening" | "thinking" | "speaking";

const LABEL: Record<Phase, string> = {
  idle: "הקישו על העיגול כדי לדבר",
  listening: "מקשיב… (הקשה על העיגול מסיימת)",
  thinking: "חושב…",
  speaking: "מדבר… (הקשה על העיגול קוטעת)",
};

/** How long a pause counts as "finished speaking". */
const SILENCE_MS = 1800;

/**
 * Voice conversation: replaces the text composer with an animated circle.
 * listening → (pause) → thinking → speaking → listening …
 *
 * The circle follows the real microphone level while the user speaks. The browser doesn't expose
 * the volume of its own synthesized voice, so while the agent speaks the motion is simulated and
 * pulses on each word boundary.
 */
export function VoiceMode({
  greeting,
  onUtterance,
  onExit,
}: {
  /** Spoken when voice mode opens (the agent's latest message). */
  greeting: string | null;
  /** Sends the user's words through the interview; resolves to the reply to speak, or null on error. */
  onUtterance: (text: string) => Promise<string | null>;
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [caption, setCaption] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const mounted = useRef(false);
  const circleRef = useRef<HTMLButtonElement>(null);
  const recRef = useRef<Recognition | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalText = useRef("");
  const interimText = useRef("");
  const speakRun = useRef(0); // bumps on every speak/cancel, so stale callbacks do nothing
  const bump = useRef(0); // short pulse (word boundary / recognition result), decays each frame
  const level = useRef(0);
  const analyser = useRef<AnalyserNode | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const stopRecognition = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
    const r = recRef.current;
    recRef.current = null;
    if (r) {
      r.onresult = r.onerror = r.onend = null;
      try {
        r.abort();
      } catch {
        // already stopped
      }
    }
  };

  const stopSpeaking = () => {
    speakRun.current++;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  };

  // ── Listening ──
  const listen = useCallback(() => {
    if (!mounted.current) return;
    stopSpeaking();
    stopRecognition();
    finalText.current = "";
    interimText.current = "";
    setCaption("");
    setError(null);
    const r = createRecognition();
    if (!r) return setError("הדפדפן הזה לא תומך בזיהוי דיבור.");
    recRef.current = r;

    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += `${res[0].transcript} `;
        else interim += res[0].transcript;
      }
      interimText.current = interim;
      setCaption(`${finalText.current}${interim}`.trim());
      bump.current = 1;
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => finish(), SILENCE_MS);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stopRecognition();
        go("idle");
        setError("אין הרשאה למיקרופון. אפשר לאשר אותה בסרגל הכתובת של הדפדפן, או להקליד בתיבה למטה.");
      } else if (e.error === "network") {
        setError("זיהוי הדיבור דורש חיבור לאינטרנט.");
      }
      // "no-speech" / "aborted" are handled in onend
    };
    r.onend = () => {
      // The browser stopped on its own (long silence, network). Send what we have, or wait for a tap.
      if (recRef.current !== r || phaseRef.current !== "listening") return;
      if (`${finalText.current}${interimText.current}`.trim()) finish();
      else {
        recRef.current = null;
        go("idle");
      }
    };

    go("listening");
    try {
      r.start();
    } catch {
      go("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Speaking ──
  const speak = useCallback(
    (text: string) => {
      if (!mounted.current) return;
      stopRecognition();
      stopSpeaking();
      const run = speakRun.current;
      const chunks = splitForSpeech(toSpeakable(text));
      if (!chunks.length) return listen();
      go("speaking");

      const next = (i: number) => {
        if (run !== speakRun.current || !mounted.current) return;
        if (i >= chunks.length) return listen();
        setCaption(chunks[i]);
        const u = new SpeechSynthesisUtterance(chunks[i]);
        u.lang = "he-IL";
        const v = hebrewVoice();
        if (v) u.voice = v;
        u.rate = 1.02;
        let done = false;
        // Some browsers occasionally never fire onend; don't get stuck.
        const guard = setTimeout(() => finishChunk(), chunks[i].length * 110 + 4000);
        function finishChunk() {
          if (done) return;
          done = true;
          clearTimeout(guard);
          next(i + 1);
        }
        u.onboundary = () => (bump.current = 1);
        u.onend = finishChunk;
        u.onerror = finishChunk;
        window.speechSynthesis.speak(u);
      };
      next(0);
    },
    [listen],
  );

  // ── Sending what was said (or typed) ──
  const send = useCallback(
    async (text: string) => {
      stopRecognition();
      if (!text.trim()) return go("idle");
      setError(null);
      setCaption(text);
      go("thinking");
      const reply = await onUtterance(text.trim());
      if (!mounted.current) return;
      if (reply) speak(reply);
      else go("idle");
    },
    [onUtterance, speak],
  );

  // `finish` is called from recognition callbacks created earlier, so read the text from refs.
  const sendRef = useRef(send);
  sendRef.current = send;
  function finish() {
    if (phaseRef.current !== "listening") return;
    sendRef.current(`${finalText.current}${interimText.current}`);
  }

  function onCircle() {
    const p = phaseRef.current;
    if (p === "speaking" || p === "idle") listen();
    else if (p === "listening") {
      if (`${finalText.current}${interimText.current}`.trim()) finish();
      else {
        stopRecognition();
        go("idle");
      }
    }
  }

  function onTyped(e: React.FormEvent) {
    e.preventDefault();
    if (phaseRef.current === "thinking" || !typed.trim()) return;
    stopSpeaking();
    const t = typed;
    setTyped("");
    send(t);
  }

  // ── Lifecycle: mic level meter, animation loop, greeting ──
  useEffect(() => {
    mounted.current = true;
    let raf = 0;

    // Android Chrome can't share the microphone between getUserMedia and speech recognition,
    // so there the listening animation is driven by recognition results instead.
    const android = /Android/i.test(navigator.userAgent);
    if (!android && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .then((s) => {
          if (!mounted.current) return s.getTracks().forEach((t) => t.stop());
          stream.current = s;
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctx();
          const node = ctx.createAnalyser();
          node.fftSize = 512;
          ctx.createMediaStreamSource(s).connect(node);
          audioCtx.current = ctx;
          analyser.current = node;
        })
        .catch(() => {
          // No meter — recognition will report its own permission error if relevant.
        });
    }

    const buf = new Uint8Array(512);
    const tick = (t: number) => {
      const p = phaseRef.current;
      let target = 0;
      if (p === "listening") {
        if (analyser.current) {
          analyser.current.getByteTimeDomainData(buf);
          let sum = 0;
          for (const x of buf) sum += ((x - 128) / 128) ** 2;
          target = Math.min(1, Math.sqrt(sum / buf.length) * 5);
        } else target = bump.current * 0.7;
      } else if (p === "speaking") {
        const wave = Math.abs(Math.sin(t / 95)) * Math.abs(Math.sin(t / 260));
        target = 0.2 + 0.35 * wave + 0.45 * bump.current;
      }
      bump.current *= 0.9;
      level.current += (target - level.current) * 0.25;
      circleRef.current?.style.setProperty("--level", level.current.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Voices load asynchronously in Chrome; give them a moment before the first sentence.
    const start = setTimeout(() => (greeting ? speak(greeting) : listen()), 250);

    return () => {
      mounted.current = false;
      clearTimeout(start);
      cancelAnimationFrame(raf);
      stopRecognition();
      stopSpeaking();
      stream.current?.getTracks().forEach((tr) => tr.stop());
      stream.current = null;
      audioCtx.current?.close().catch(() => {});
      audioCtx.current = null;
      analyser.current = null;
    };
    // Run once per mount; `greeting` is only the opening line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`voice ${phase}`}>
      <div className="voice-stage">
        <button
          ref={circleRef}
          className="voice-orb"
          onClick={onCircle}
          disabled={phase === "thinking"}
          aria-label={LABEL[phase]}
        >
          <span className="voice-ring" aria-hidden />
          <span className="voice-core" aria-hidden />
        </button>
        <div className="voice-label" aria-live="polite">{LABEL[phase]}</div>
        <div className="voice-caption">{caption}</div>
        {error && <div className="error">{error}</div>}
      </div>
      <form className="voice-type" onSubmit={onTyped}>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="מספרים ארוכים (ת.ז., טלפון) עדיף להקליד כאן"
          aria-label="הקלדה במצב קולי"
          disabled={phase === "thinking"}
        />
        <button className="btn" type="submit" disabled={phase === "thinking" || !typed.trim()}>שליחה</button>
        <button className="btn" type="button" onClick={onExit}>⌨️ חזרה להקלדה</button>
      </form>
    </div>
  );
}
