import { NextResponse } from "next/server";
import { z } from "zod";
import { ModelRefusalError } from "@/lib/llm";
import { generateDraft } from "@/lib/pipeline";
import { CaseFileSchema, FIELD_KEYS } from "@/lib/schema";
import { validateCase } from "@/lib/validate";
import { todayInIsrael } from "@/lib/config";

export const runtime = "nodejs";
// Draft + critic + revision + re-check are four model calls; allow up to 5 minutes.
export const maxDuration = 300;

const BodySchema = z.object({ caseFile: CaseFileSchema, unknownFields: z.array(z.enum(FIELD_KEYS)) });

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  const { caseFile, unknownFields } = parsed.data;

  // Validation is enforced on the server too — the client's button state is not trusted.
  const validation = validateCase(caseFile, unknownFields, todayInIsrael());
  if (!validation.canDraft) {
    return NextResponse.json({ error: "המידע בתיק עדיין לא מספיק ליצירת טיוטה.", validation }, { status: 422 });
  }
  try {
    return NextResponse.json(await generateDraft(caseFile, unknownFields));
  } catch (err) {
    console.error("draft error", err);
    const message = err instanceof ModelRefusalError ? "לא ניתן היה לנסח את הטיוטה." : "אירעה שגיאה ביצירת הטיוטה. נסו שוב.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
