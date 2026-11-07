import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from "docx";
import type { Recording, TimestampMode } from "../../types";
import { parseMarkdown, type InlineRun } from "../markdown";
import { timestampFormatter } from "../time";
import { normalizeSegments, sortMarkers } from "../transcript";
import { metaLines } from "./text";

const FONT = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Yu Gothic", cs: "Calibri" };
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
const TIMESTAMP_COLOR = "2563EB";

function runs(inlines: InlineRun[]): TextRun[] {
  return inlines.map(
    (r) => new TextRun({ text: r.text, bold: r.bold, ...(r.code ? { font: "Consolas", shading: { fill: "F1F5F9" } } : {}) }),
  );
}

/** 要約（Markdown）を Word の段落に変換する。見出しは「要約」(見出し1) の下に入るよう 1 段下げる。 */
function summaryParagraphs(md: string): Paragraph[] {
  return parseMarkdown(md).map((b) => {
    switch (b.type) {
      case "heading":
        // "# / ##" → 見出し2、"###" → 見出し3、それ以下 → 見出し4
        return new Paragraph({ heading: HEADINGS[Math.min(3, Math.max(1, b.level - 1))], children: runs(b.runs) });
      case "bullet":
        return new Paragraph({ bullet: { level: b.level }, children: runs(b.runs) });
      case "numbered":
        return new Paragraph({ numbering: { reference: "summary-numbers", level: b.level }, children: runs(b.runs) });
      default:
        return new Paragraph({ children: runs(b.runs), spacing: { after: 120 } });
    }
  });
}

export function buildDocx(rec: Recording, mode: TimestampMode): Document {
  const fmt = timestampFormatter(mode, rec.createdAt, rec.pauses, true);
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(rec.title)] }),
    ...metaLines(rec).map(
      ([k, v]) => new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v)] }),
    ),
  ];

  if (rec.summary) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("要約")] }));
    children.push(...summaryParagraphs(rec.summary.text));
  }

  const markers = sortMarkers(rec.markers);
  if (markers.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("マーカー")] }));
    for (const m of markers) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: `[${fmt(m.time)}] `, bold: true, color: TIMESTAMP_COLOR }),
            new TextRun(m.note.trim() || "マーカー"),
          ],
        }),
      );
    }
  }

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("文字起こし")] }));
  const segs = normalizeSegments(rec.segments);
  if (segs.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: "（文字起こしはありません）", italics: true })] }));
  }
  for (const s of segs) {
    children.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `[${fmt(s.start)}]`, bold: true, color: TIMESTAMP_COLOR }),
          new TextRun({ text: `  ${s.text.trim()}` }),
        ],
      }),
    );
  }

  return new Document({
    creator: "Voice Recorder",
    title: rec.title,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    numbering: {
      config: [
        {
          reference: "summary-numbers",
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children }],
  });
}

export async function toDocxBlob(rec: Recording, mode: TimestampMode): Promise<Blob> {
  return Packer.toBlob(buildDocx(rec, mode));
}
