import { describe, it, expect } from "vitest";
import { docxText, pptxText, xlsxText, localKind, decodeXml, extractLocalText } from "../../../supabase/functions/_shared/localExtract";

const enc = (s: string) => new TextEncoder().encode(s);

describe("local document extraction", () => {
  it("recognises types by mime or file extension", () => {
    expect(localKind("application/pdf", "x")).toBe("pdf");
    expect(localKind("", "OTF Offer Letter.docx.pdf")).toBe("pdf");
    expect(localKind("", "Budget.XLSX")).toBe("xlsx");
    expect(localKind("", "deck (2).pptx")).toBe("pptx");
    expect(localKind("application/octet-stream", "notes.txt")).toBeNull();
  });
  it("decodes xml entities", () => {
    expect(decodeXml("Tom &amp; Jerry &lt;3 &#65;&#x42;")).toBe("Tom & Jerry <3 AB");
  });
  it("reads Word paragraphs and tabs, ignoring tag-like names such as w:tab and w:tbl", () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Offer </w:t></w:r><w:r><w:t>Letter</w:t></w:r></w:p><w:tbl><w:p><w:r><w:t>Role</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Coach &amp; Lead</w:t></w:r></w:p></w:tbl></w:body></w:document>';
    expect(docxText({ "word/document.xml": enc(xml) })).toBe("Offer Letter\nRole\tCoach & Lead");
  });
  it("reads PowerPoint slides in numeric order", () => {
    const f = { "ppt/slides/slide10.xml": enc("<a:p><a:t>Ten</a:t></a:p>"), "ppt/slides/slide2.xml": enc("<a:p><a:t>Two</a:t></a:p>") };
    expect(pptxText(f)).toBe("## Slide 1\nTwo\n\n## Slide 2\nTen");
  });
  it("reads Excel sheets with shared and inline strings", () => {
    const f = {
      "xl/workbook.xml": enc('<workbook><sheets><sheet name="Budget" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": enc('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/sharedStrings.xml": enc("<sst><si><t>Item</t></si><si><t>Rent &amp; bills</t></si></sst>"),
      "xl/worksheets/sheet1.xml": enc('<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>5</v></c></row><row><c t="s"><v>1</v></c><c t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>'),
    };
    expect(xlsxText(f)).toBe("## Sheet: Budget\nItem\t5\nRent & bills\tx");
  });
  it("never throws and returns null when it cannot read a file", async () => {
    expect(await extractLocalText(new ArrayBuffer(4), "", "notes.bin")).toBeNull();
    expect(await extractLocalText(new ArrayBuffer(4), "", "broken.docx", { unzipSync: () => { throw new Error("bad zip"); } })).toBeNull();
  });
});
