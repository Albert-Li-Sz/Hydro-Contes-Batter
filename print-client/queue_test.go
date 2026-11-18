package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"
)

// A fake Hydro print server: every poll hands out one job; reports are recorded by status.
type fakeHydro struct {
	mu      sync.Mutex
	nexts   int
	reports map[string]int
	failAt  int // answer report with 500 this many times first
}

func (f *fakeHydro) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch filepath.Base(r.URL.Path) {
	case "heartbeat":
		json.NewEncoder(w).Encode(map[string]any{"name": "x", "enabled": true, "pollMs": 3000,
			"preferences": map[string]any{"保存到文件夹 1": map[string]any{"enabled": true, "weight": 1}}})
	case "next":
		f.nexts++
		json.NewEncoder(w).Encode(map[string]any{"jobs": []any{map[string]any{"id": "job", "title": "a.cpp"}}})
	case "report":
		if f.failAt > 0 {
			f.failAt--
			w.WriteHeader(500)
			return
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		f.reports[body["status"].(string)]++
		w.Write([]byte("{}"))
	}
}

func TestFailedPrinterRestsInsteadOfBurningTheQueue(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses the CUPS printer list")
	}
	t.Setenv("PATH", t.TempDir()) // no lpstat: only the folder printer
	hydro := &fakeHydro{reports: map[string]int{}}
	server := httptest.NewServer(hydro)
	defer server.Close()
	// A file where the folder should be, so the first printout fails and the printer rests.
	blocker := filepath.Join(t.TempDir(), "not-a-folder")
	os.WriteFile(blocker, nil, 0o644)
	folder, folderCount = blocker, 1
	defer func() { folder, folderCount = "", 1 }()
	go run(&Client{conn: Connection{URL: server.URL, ID: "id", Token: "t"}, http: server.Client()}, A4)
	time.Sleep(time.Second)
	hydro.mu.Lock()
	defer hydro.mu.Unlock()
	if hydro.nexts != 1 || hydro.reports["failed"] != 1 || hydro.reports["released"] != 0 {
		t.Fatalf("a resting printer must not take more jobs: %d polls, reports %v", hydro.nexts, hydro.reports)
	}
}

func TestReportRetriesServerErrorsButNotRefusals(t *testing.T) {
	saved := reportRetries
	reportRetries = []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond}
	defer func() { reportRetries = saved }()
	hydro := &fakeHydro{reports: map[string]int{}, failAt: 2}
	server := httptest.NewServer(hydro)
	defer server.Close()
	client := &Client{conn: Connection{URL: server.URL, ID: "id", Token: "t"}, http: server.Client()}
	if err := report(client, map[string]any{"id": "job", "status": "printed"}); err != nil || hydro.reports["printed"] != 1 {
		t.Fatalf("want the report delivered after two server errors, got %v, %v", err, hydro.reports)
	}
	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte(`{"error":"打印请求不存在"}`))
	}))
	defer refusing.Close()
	start := time.Now()
	err := report(&Client{conn: Connection{URL: refusing.URL, ID: "id", Token: "t"}, http: refusing.Client()}, map[string]any{"id": "job"})
	if err == nil || err.Error() != "打印请求不存在" || time.Since(start) > 500*time.Millisecond {
		t.Fatalf("a refusal is final: got %v after %v", err, time.Since(start))
	}
}
