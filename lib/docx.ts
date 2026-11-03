/**
 * Markdown (the subset the drafter produces) → DOCX with proper right-to-left layout.
 * RTL in Word needs both: paragraph `bidirectional` and run `rightToLeft` (+ a complex-script font size).
 */
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun, Footer } from "docx";
import { DISCLAIMER } from "./config";

const FONT = "David";
/** The "- נגד -" line between the parties (bare or bold). */
const VERSUS = /^(\*\*)?-\s*נגד\s*-(\*\*)?$/;

function runs(text: string, opts: { size?: number; bold?: boolean } = {}): TextRun[] {
  // **bold** segments
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((seg) => {
    const bold = seg.startsWith("**") && seg.endsWith("**");
    const t = bold ? seg.slice(2, -2) : seg;
    const highlight = /\[להשלמה/.test(t) ? "yellow" : undefined;
    return new TextRun({
      text: t,
      bold: bold || opts.bold,
      rightToLeft: true,
      font: { name: FONT, hint: "cs" },
      size: opts.size ?? 24,
      sizeComplexScript: opts.size ?? 24,
      boldComplexScript: bold || opts.bold,
      highlight,
    });
  });
}

const para = (children: TextRun[], extra: Partial<ConstructorParameters<typeof Paragraph>[0] & object> = {}) =>
  new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { after: 120, line: 320 }, children, ...extra });

export async function markdownToDocx(md: string): Promise<Buffer> {
  const children: Paragraph[] = [];
  children.push(para(runs(`טיוטה — ${DISCLAIMER}`, { size: 18 }), { border: { bottom: { style: "single", size: 4, color: "999999", space: 4 } } }));

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#\s+(.*)/))) {
      children.push(para(runs(m[1], { size: 30, bold: true }), { heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }));
    } else if ((m = line.match(/^##\s+(.*)/))) {
      const center = /כתב תביעה/.test(m[1]);
      children.push(para(runs(m[1], { size: 26, bold: true }), { heading: HeadingLevel.HEADING_2, alignment: center ? AlignmentType.CENTER : AlignmentType.RIGHT, spacing: { before: 240, after: 120 } }));
    } else if ((m = line.match(/^###\s+(.*)/))) {
      children.push(para(runs(m[1], { bold: true })));
    } else if ((m = line.match(/^\s*(\d+)\.\s+(.*)/))) {
      // Numbered paragraphs keep their explicit number (numbering runs across sections).
      children.push(para(runs(`${m[1]}. ${m[2]}`), { indent: { right: 360, hanging: 360 } }));
    } else if (VERSUS.test(line.trim())) {
      children.push(para(runs("- נגד -", { bold: true }), { alignment: AlignmentType.CENTER }));
    } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      children.push(para(runs(`• ${m[1]}`), { indent: { right: 360 } }));
    } else if (/^---+$/.test(line.trim())) {
      continue;
    } else {
      const center = /^\*\*?ת"ק|^ת"ק/.test(line.trim());
      children.push(para(runs(line.trim()), center ? { alignment: AlignmentType.CENTER } : {}));
    }
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, rightToLeft: true } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } },
        footers: { default: new Footer({ children: [para(runs("טיוטה — אינה מהווה ייעוץ משפטי", { size: 16 }), { alignment: AlignmentType.CENTER })] }) },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
