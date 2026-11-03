import { z } from "zod";
import { markdownToDocx } from "@/lib/docx";

export const runtime = "nodejs";

const BodySchema = z.object({ markdown: z.string().min(1).max(200_000) });

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("בקשה לא תקינה", { status: 400 });
  const buf = await markdownToDocx(parsed.data.markdown);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="kitav-tvia-draft.docx"`,
    },
  });
}
