package main

// A sample job for `--sample`: shows the layout without a Hydro server.
func sampleJob() Job {
	k := func(text string) [2]string { return [2]string{"k", text} }
	p := func(text string) [2]string { return [2]string{"", text} }
	c := func(text string) [2]string { return [2]string{"c", text} }
	s := func(text string) [2]string { return [2]string{"s", text} }
	lines := [][][2]string{
		{{"p", "#include <bits/stdc++.h>"}},
		{k("using"), p(" "), k("namespace"), p(" std;")},
		{},
		{c("// 前缀和：读入 n 个整数，输出每个前缀的和（打印样张）")},
		{k("int"), p(" main() {")},
		{p("    "), k("int"), p(" n; "), k("long long"), p(" sum = "), [2]string{"n", "0"}, p(";")},
		{p("    cin >> n;")},
		{p("    "), k("for"), p(" ("), k("int"), p(" i = "), [2]string{"n", "0"}, p("; i < n; i++) {")},
		{p("        "), k("long long"), p(" x; cin >> x; sum += x;")},
		{p("        cout << sum << (i + "), [2]string{"n", "1"}, p(" == n ? "), s(`"\n"`), p(" : "), s(`" "`), p("); "), c("/* 末尾换行 */")},
		{p("    }")},
		{p("    "), k("return"), p(" "), [2]string{"n", "0"}, p(";")},
		{p("}")},
		{c("// A very long line to show wrapping: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")},
	}
	return Job{
		ID: "sample", Title: "打印样张", Contest: "Hydro 打印服务器 · 样张",
		Header: Header{Team: "星火队", Seat: "A-01", Rows: [][2]string{
			{"学校", "南京晓庄学院"}, {"队员", "林澈、周宁、陈言"}, {"文件", "a.cpp"}, {"语言", "C++"}, {"请求时间", "2026/11/18 14:00:00"}, {"行数", "14"},
		}},
		Lines: lines, FontSize: 10, Numbers: true,
	}
}
