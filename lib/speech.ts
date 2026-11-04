/**
 * Browser speech helpers for voice mode. Everything here uses the Web Speech API built into the
 * browser — no extra API calls or keys. Speech recognition turns the user's voice into text that
 * goes through the normal interview; speech synthesis reads the agent's reply aloud.
 *
 * Note: in Chrome, speech recognition is processed on Google's servers (a browser feature, not
 * something this app controls).
 */

// Minimal typings — SpeechRecognition isn't in TypeScript's DOM lib yet.
export type RecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Voice mode needs both halves; Firefox, for example, has no speech recognition. */
export function voiceSupported() {
  return !!recognitionCtor() && typeof window !== "undefined" && "speechSynthesis" in window;
}

export function createRecognition(): Recognition | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "he-IL";
  r.continuous = true; // we decide when the user finished (silence timer), not the browser
  r.interimResults = true;
  return r;
}

/** Turns a chat message into something that sounds right when read aloud. */
export function toSpeakable(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, "בקישור שמופיע בצ'אט")
    .replace(/\[להשלמה\]/g, "להשלמה")
    .replace(/(\d[\d,.]*)\s*₪/g, "$1 שקלים")
    .replace(/₪\s*(\d[\d,.]*)/g, "$1 שקלים")
    .replace(/₪/g, "שקלים")
    .replace(/ש"ח/g, "שקלים")
    .replace(/[*_#>`]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

/** Sentence-sized chunks: Chrome cuts off long utterances after ~15 seconds. */
export function splitForSpeech(text: string, max = 180): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    const prev = out[out.length - 1];
    if (prev && prev.length + s.length + 1 <= max) out[out.length - 1] = `${prev} ${s}`;
    else out.push(s);
  }
  return out;
}

let cachedVoice: SpeechSynthesisVoice | null | undefined;

/** Picks a Hebrew voice, preferring the more natural "online"/Google/Natural ones when present. */
export function hebrewVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("he") || v.lang.startsWith("iw"));
  if (!voices.length) return null; // voices may still be loading; try again next time
  const score = (v: SpeechSynthesisVoice) => (/natural|online|google|neural/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  cachedVoice = voices.sort((a, b) => score(b) - score(a))[0];
  return cachedVoice;
}

/** iOS/Safari only allow speech after a user gesture: call this from the click that enables voice mode. */
export function unlockSpeech() {
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
    window.speechSynthesis.getVoices(); // starts loading voices in Chrome
  } catch {
    // ignore
  }
}
