//go:build !windows

package main

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
)

// CUPS commands with English output, so they parse the same in every locale.
func cups(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.Env = append(os.Environ(), "LANG=C", "LC_ALL=C")
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	err := cmd.Run()
	if err != nil {
		message := strings.TrimSpace(errOut.String())
		if message == "" {
			message = err.Error()
		}
		return out.String(), fmt.Errorf("%s: %s", name, message)
	}
	return out.String(), nil
}

var printerLine = regexp.MustCompile(`^printer (\S+) (?:is |now )?(\S+)`)

func listPrinters() ([]SysPrinter, error) {
	out, err := cups("lpstat", "-p")
	if err != nil && strings.TrimSpace(out) == "" {
		if strings.Contains(err.Error(), "No destinations") || strings.Contains(err.Error(), "no destinations") {
			return nil, nil
		}
		return nil, fmt.Errorf("无法读取打印机列表（需要 CUPS 的 lpstat）：%v", err)
	}
	defaultName := ""
	if d, err := cups("lpstat", "-d"); err == nil {
		if i := strings.Index(d, ":"); i >= 0 {
			defaultName = strings.TrimSpace(d[i+1:])
		}
	}
	var printers []SysPrinter
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		m := printerLine.FindStringSubmatch(line)
		if m == nil {
			// A reason line under the printer ("\tPaper out").
			if len(printers) > 0 && strings.HasPrefix(line, "\t") {
				printers[len(printers)-1].Message = strings.TrimSpace(line)
			}
			continue
		}
		p := SysPrinter{Name: m[1], Status: "idle", IsDefault: m[1] == defaultName}
		switch {
		case strings.Contains(line, "disabled"):
			p.Status = "paused"
		case strings.Contains(line, "now printing"):
			p.Status = "printing"
		}
		p.Virtual = virtualPrinter(p.Name)
		if jobs, err := cups("lpstat", "-o", p.Name); err == nil {
			if trimmed := strings.TrimSpace(jobs); trimmed != "" {
				p.Queue = strings.Count(trimmed, "\n") + 1
			}
		}
		printers = append(printers, p)
	}
	return printers, nil
}

func printOn(printer string, job Job, paper Paper) error {
	pages := Layout(job, paper)
	file, err := os.CreateTemp("", "hydro-print-*.pdf")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(WritePDF(pages, paper, job.Title)); err != nil {
		file.Close()
		return err
	}
	file.Close()
	media := "A4"
	if paper == Letter {
		media = "Letter"
	}
	title := job.Title
	if title == "" {
		title = "Hydro"
	}
	_, err = cups("lp", "-d", printer, "-t", title, "-o", "media="+media, file.Name())
	return err
}

func systemName() string {
	if runtime.GOOS == "darwin" {
		if out, err := exec.Command("sw_vers", "-productVersion").Output(); err == nil {
			return "macOS " + strings.TrimSpace(string(out))
		}
		return "macOS"
	}
	if data, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)
			}
		}
	}
	return runtime.GOOS
}

// Nothing to keep open on these systems.
func waitBeforeExit() {}
