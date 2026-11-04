import { NextResponse } from "next/server";
import { z } from "zod";
import { ModelRefusalError } from "@/lib/llm";
import { interviewTurn } from "@/lib/pipeline";
import { CaseFileSchema, FIELD_KEYS } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

const BodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(120),
  caseFile: CaseFileSchema,
  unknownFields: z.array(z.enum(FIELD_KEYS)),
  raisedIssueCodes: z.array(z.string()),
  voice: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  const { messages, voice, ...state } = parsed.data;
  try {
    return NextResponse.json(await interviewTurn(messages, state, { voice }));
  } catch (err) {
    console.error("interview error", err);
    const message = err instanceof ModelRefusalError ? "לא ניתן לעבד את ההודעה הזו. נסו לנסח אותה מחדש." : "אירעה שגיאה בעיבוד ההודעה. נסו שוב.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
