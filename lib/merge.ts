/**
 * Code-side merge of the model's updated case file into the previous one.
 * The model returns the whole case file each turn; this guard makes sure a lapse of the model
 * (returning null for something it already knew, or dropping a fact) never loses data.
 */
import type { CaseFile, FieldKey } from "./schema";
import { FIELD_DEFS } from "./fields";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function mergeValue(prev: Json, next: Json): Json {
  if (next === null || next === undefined) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (next.length >= prev.length) return next;
    // The model returned fewer items than we had: keep the old ones, add any new ones.
    const seen = new Set(prev.map((v) => JSON.stringify(v)));
    return [...prev, ...next.filter((v) => !seen.has(JSON.stringify(v)))];
  }
  if (typeof prev === "object" && prev !== null && !Array.isArray(prev) && typeof next === "object" && !Array.isArray(next)) {
    const out: { [k: string]: Json } = { ...prev };
    for (const k of Object.keys(next)) out[k] = mergeValue(prev[k] ?? null, next[k]);
    return out;
  }
  if (typeof next === "string" && next.trim() === "") return prev;
  return next;
}

export function mergeCaseFile(prev: CaseFile, next: CaseFile): CaseFile {
  return mergeValue(prev as unknown as Json, next as unknown as Json) as unknown as CaseFile;
}

/** Union of unknown fields, minus any that have since been filled. */
export function mergeUnknown(c: CaseFile, prev: FieldKey[], next: FieldKey[]): FieldKey[] {
  const all = Array.from(new Set([...prev, ...next]));
  return all.filter((k) => {
    const def = FIELD_DEFS.find((f) => f.key === k);
    return def ? def.display(c) == null : false;
  });
}
