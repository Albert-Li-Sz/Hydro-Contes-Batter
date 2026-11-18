package main

import (
	"bytes"
	"strings"
	"testing"
)

func longJob(lines int) Job {
	job := sampleJob()
	job.Lines = nil
	for i := 0; i < lines; i++ {
		job.Lines = append(job.Lines, [][2]string{{"k", "int"}, {"", " x = 1; // 第几行"}})
	}
	return job
}

func TestLayoutRepeatsHeaderAndNumbersPages(t *testing.T) {
	pages := Layout(longJob(200), A4)
	if len(pages) < 3 {
		t.Fatalf("200 lines should take several pages, got %d", len(pages))
	}
	for i, page := range pages {
		// The header box and the seat box on every page, and the page number.
		if len(page.Rects) != 2 {
			t.Fatalf("page %d: want header and seat boxes, got %d rects", i+1, len(page.Rects))
		}
		found := false
		for _, text := range page.Texts {
			if strings.Contains(text.Text, "A-01") {
				found = true
			}
		}
		if !found {
			t.Fatalf("page %d has no seat", i+1)
		}
	}
	// Every source line is numbered exactly once across the pages.
	numbers := 0
	for _, page := range pages {
		for _, text := range page.Texts {
			if text.Style.Family == FamilyMono && text.Style.Gray == 0.4 {
				numbers++
			}
		}
	}
	if numbers != 200 {
		t.Fatalf("want 200 line numbers, got %d", numbers)
	}
}

func TestWrapKeepsEveryCharacter(t *testing.T) {
	runs := [][2]string{{"", strings.Repeat("a", 150)}, {"c", "// 中文注释"}}
	lines := wrapLine(runs, 7, 10, 300)
	if len(lines) < 2 || lines[0].number != 7 || lines[1].number != 0 {
		t.Fatalf("long line should wrap with the number on its first part: %+v", lines)
	}
	var all strings.Builder
	for _, line := range lines {
		width := 0.0
		for _, run := range line.runs {
			all.WriteString(run[1])
			width += textWidth(run[1], styleFor(run[0], 10))
		}
		if width > 300.001 {
			t.Fatalf("line wider than the column: %.1f", width)
		}
	}
	if all.String() != strings.Repeat("a", 150)+"// 中文注释" {
		t.Fatalf("text changed by wrapping: %q", all.String())
	}
}

func TestBalancerFollowsWeightsAndSkipsUnusablePrinters(t *testing.T) {
	printers := []SysPrinter{{Name: "A", Status: "idle"}, {Name: "B", Status: "idle"}, {Name: "C", Status: "error"}, {Name: "D", Status: "idle"}}
	prefs := map[string]Preference{"A": {Enabled: true, Weight: 3}, "B": {Enabled: true, Weight: 1}, "C": {Enabled: true, Weight: 5}, "D": {Enabled: false, Weight: 5}}
	var b Balancer
	counts := map[string]int{}
	for i := 0; i < 40; i++ {
		name, ok := b.pick(printers, prefs)
		if !ok {
			t.Fatal("no printer picked")
		}
		counts[name]++
	}
	if counts["A"] != 30 || counts["B"] != 10 || counts["C"] != 0 || counts["D"] != 0 {
		t.Fatalf("want A:B = 3:1 and no error or disabled printer, got %v", counts)
	}
	b.rest("A")
	if name, _ := b.pick(printers, prefs); name != "B" {
		t.Fatalf("a failed printer rests: want B, got %s", name)
	}
}

func TestConnectionCodeAndPDF(t *testing.T) {
	conn, err := parseCode("  hydro-print:eyJ2IjoxLCJ1cmwiOiJodHRwczovL29qLmV4YW1wbGUuY29tLyIsImlkIjoiYSIsInRva2VuIjoidCJ9\n")
	if err != nil || conn.URL != "https://oj.example.com" || conn.ID != "a" || conn.Token != "t" {
		t.Fatalf("parse: %+v %v", conn, err)
	}
	if _, err := parseCode("nonsense"); err == nil {
		t.Fatal("bad code accepted")
	}
	pdf := WritePDF(Layout(sampleJob(), A4), A4, "样张")
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) || !bytes.Contains(pdf, []byte("/STSong-Light")) || !bytes.HasSuffix(pdf, []byte("%%EOF\n")) {
		t.Fatal("not a complete PDF")
	}
}
