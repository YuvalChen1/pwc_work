// Server-side only: never import this module from a client component (it reads the API key).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { MODEL } from "./config";

/** The API key is read here only, server-side (env ANTHROPIC_API_KEY). */
let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set (add it to .env.local or to the Vercel project settings).");
  }
  client ??= new Anthropic();
  return client;
}

const promptCache = new Map<string, string>();
/** Prompts live as readable Markdown files in /prompts. */
export function loadPrompt(name: "interview" | "draft" | "critic" | "revise" | "simulated-user"): string {
  if (!promptCache.has(name)) {
    promptCache.set(name, readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8"));
  }
  return promptCache.get(name)!;
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Shared request options:
 * - adaptive thinking is on by default for this model family; effort tunes its depth per stage.
 * - fallbacks: "default" — if a safety classifier declines, the API re-runs the request on
 *   Anthropic's recommended fallback model instead of returning a refusal.
 * - the system prompt is cached (it is identical across turns).
 */
function baseParams(system: string, effort: Effort) {
  return {
    model: MODEL,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }],
    output_config: { effort },
  };
}

export class ModelRefusalError extends Error {}

/** One call that must return JSON matching a Zod schema (structured outputs — enforced by the API). */
export async function callStructured<T extends z.ZodType>(opts: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: T;
  effort: Effort;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const base = baseParams(opts.system, opts.effort);
  const res = await getClient().beta.messages.parse({
    ...base,
    max_tokens: opts.maxTokens ?? 16000,
    messages: opts.messages,
    output_config: { ...base.output_config, format: betaZodOutputFormat(opts.schema) },
  });
  if (res.stop_reason === "refusal") throw new ModelRefusalError("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("The model response was cut off (max_tokens).");
  if (res.parsed_output == null) throw new Error("The model did not return valid structured output.");
  return res.parsed_output as z.infer<T>;
}

/** One call that returns free text (the Markdown draft). Streamed to avoid HTTP timeouts on long outputs. */
export async function callText(opts: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  effort: Effort;
  maxTokens?: number;
}): Promise<string> {
  const stream = getClient().beta.messages.stream({
    ...baseParams(opts.system, opts.effort),
    max_tokens: opts.maxTokens ?? 32000,
    messages: opts.messages,
  });
  const res = await stream.finalMessage();
  if (res.stop_reason === "refusal") throw new ModelRefusalError("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("The model response was cut off (max_tokens).");
  return res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
