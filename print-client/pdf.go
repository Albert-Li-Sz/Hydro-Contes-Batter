package main

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"strings"
	"unicode/utf16"
)

// WritePDF renders pages to a PDF using fonts every PDF reader and CUPS provide: Courier and
// Helvetica for Latin text, and the predefined Chinese font STSong-Light (Adobe-GB1, not
// embedded) for everything else, which readers map to an installed CJK font. No font files needed.
func WritePDF(pages []Page, paper Paper, title string) []byte {
	var out bytes.Buffer
	var offsets []int
	object := func(body string) int {
		offsets = append(offsets, out.Len())
		fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", len(offsets), body)
		return len(offsets)
	}
	stream := func(dict string, data []byte) int {
		var z bytes.Buffer
		w := zlib.NewWriter(&z)
		w.Write(data)
		w.Close()
		offsets = append(offsets, out.Len())
		fmt.Fprintf(&out, "%d 0 obj\n<< %s /Length %d /Filter /FlateDecode >>\nstream\n", len(offsets), dict, z.Len())
		out.Write(z.Bytes())
		out.WriteString("\nendstream\nendobj\n")
		return len(offsets)
	}
	out.WriteString("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
	// 1 catalog, 2 pages (written last by number), fonts after.
	object("<< /Type /Catalog /Pages 2 0 R >>")
	offsets = append(offsets, -1) // reserve 2 for the page tree
	base := func(name string) int {
		return object(fmt.Sprintf("<< /Type /Font /Subtype /Type1 /BaseFont /%s /Encoding /WinAnsiEncoding >>", name))
	}
	fonts := map[string]int{
		"F1": base("Courier"), "F2": base("Courier-Bold"), "F3": base("Courier-Oblique"), "F4": base("Courier-BoldOblique"),
		"F5": base("Helvetica"), "F6": base("Helvetica-Bold"), "F7": base("Helvetica-Oblique"), "F8": base("Helvetica-BoldOblique"),
	}
	descriptor := object("<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>")
	cid := object(fmt.Sprintf("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor %d 0 R /DW 1000 >>", descriptor))
	fonts["F9"] = object(fmt.Sprintf("<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light-UniGB-UCS2-H /Encoding /UniGB-UCS2-H /DescendantFonts [%d 0 R] >>", cid))
	var fontDict strings.Builder
	for _, name := range []string{"F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9"} {
		fmt.Fprintf(&fontDict, "/%s %d 0 R ", name, fonts[name])
	}
	var kids []string
	for _, page := range pages {
		content := pageContent(page, paper)
		c := stream("", content)
		p := object(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Resources << /Font << %s>> >> /Contents %d 0 R >>", paper.Width, paper.Height, fontDict.String(), c))
		kids = append(kids, fmt.Sprintf("%d 0 R", p))
	}
	info := object(fmt.Sprintf("<< /Title %s /Producer (Hydro print client) >>", pdfUTF16(title)))
	// The page tree in its reserved slot.
	offsets[1] = out.Len()
	fmt.Fprintf(&out, "2 0 obj\n<< /Type /Pages /Kids [%s] /Count %d >>\nendobj\n", strings.Join(kids, " "), len(kids))
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&out, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, info, xref)
	return out.Bytes()
}

func pageContent(page Page, paper Paper) []byte {
	var b bytes.Buffer
	y := func(top float64) float64 { return paper.Height - top }
	for _, r := range page.Rects {
		fmt.Fprintf(&b, "0 G %.2f w %.2f %.2f %.2f %.2f re S\n", r.Width, r.X, y(r.Y+r.H), r.W, r.H)
	}
	for _, l := range page.Lines {
		fmt.Fprintf(&b, "%.2f G %.2f w %.2f %.2f m %.2f %.2f l S\n", l.Gray, l.Width, l.X1, y(l.Y1), l.X2, y(l.Y2))
	}
	for _, t := range page.Texts {
		font := latinFont(t.Style)
		skew := 0.0
		mode := 0
		var text string
		if t.Wide {
			font = "F9"
			text = cjkHex(t.Text)
			// The Chinese font has no bold or italic: stroke for bold, slant for italic.
			if t.Style.Bold {
				mode = 2
			}
			if t.Style.Italic {
				skew = 0.2
			}
		} else {
			text = latinString(t.Text)
		}
		fmt.Fprintf(&b, "BT %.2f g %.2f G %d Tr %.2f w /%s %.2f Tf 1 0 %.2f 1 %.2f %.2f Tm %s Tj ET\n",
			t.Style.Gray, t.Style.Gray, mode, t.Style.Size*0.03, font, t.Style.Size, skew, t.X, y(t.Y), text)
	}
	return b.Bytes()
}

func latinFont(s Style) string {
	index := 1
	if s.Family == FamilySans {
		index = 5
	}
	if s.Bold {
		index++
	}
	if s.Italic {
		index += 2
	}
	return fmt.Sprintf("F%d", index)
}

// A WinAnsi string literal: Latin-1 bytes with ( ) \ escaped.
func latinString(text string) string {
	var b strings.Builder
	b.WriteByte('(')
	for _, r := range text {
		switch {
		case r == '(' || r == ')' || r == '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case r < 0x20:
			b.WriteByte(' ')
		case r <= 0xFF:
			b.WriteByte(byte(r))
		default:
			b.WriteByte('?')
		}
	}
	b.WriteByte(')')
	return b.String()
}

// UCS-2 big-endian hex for the UniGB-UCS2-H encoding; characters beyond the BMP print as a full-width ？.
func cjkHex(text string) string {
	var b strings.Builder
	b.WriteByte('<')
	for _, r := range text {
		if r > 0xFFFF {
			r = 0xFF1F
		}
		fmt.Fprintf(&b, "%04X", r)
	}
	b.WriteByte('>')
	return b.String()
}

func pdfUTF16(text string) string {
	var b strings.Builder
	b.WriteString("<FEFF")
	for _, unit := range utf16.Encode([]rune(text)) {
		fmt.Fprintf(&b, "%04X", unit)
	}
	b.WriteByte('>')
	return b.String()
}
