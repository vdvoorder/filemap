import { expect } from 'claude-code/testing'

import { shellReads } from '../hooks/shell'
import { useWindows } from '../hooks/track'
import { test } from './limit'

test('Bash: cat, head, tail and the other readers name their files, and no option, value of an option or target of a redirect', () => {
  expect(shellReads('Bash', 'cat src/a.ts && head -n 20 "docs/my guide.md" | tail -c 5 > out.txt 2>&1', '')).toEqual(['src/a.ts', 'docs/my guide.md'])
  expect(shellReads('Bash', 'wc -l src/a.ts src/b.ts >> counts.txt; diff -u old.ts new.ts 2>/dev/null', '')).toEqual(['src/a.ts', 'src/b.ts', 'old.ts', 'new.ts'])
  expect(shellReads('Bash', 'sudo FOO=1 /usr/bin/cat.exe notes.md', '')).toEqual(['notes.md'])
})

test('Bash: rg, grep, sed, awk and jq take their first word as the pattern unless -e or -f gives it, and sed -i reads nothing', () => {
  expect(shellReads('Bash', 'rg -n "TODO" src/lib', '')).toEqual(['src/lib'])
  expect(shellReads('Bash', 'grep -e foo -e bar -A 2 a.ts b.ts', '')).toEqual(['a.ts', 'b.ts'])
  expect(shellReads('Bash', "sed -n '1,20p' a.ts; sed -i 's/a/b/' b.ts", '')).toEqual(['a.ts'])
  expect(shellReads('Bash', "awk '{print $1}' data.csv | jq .name package.json", '')).toEqual(['data.csv', 'package.json'])
  expect(shellReads('Bash', 'rg -- -x -y.ts', '')).toEqual(['-y.ts'])
})

test('Bash: a search adds the files it prints: lines with a line number, lines with a colon, and the lines of a listing', () => {
  expect(shellReads('Bash', 'rg -l foo', 'src/a.ts\nsrc/b c.ts\n')).toEqual(['src/a.ts', 'src/b c.ts'])
  expect(shellReads('Bash', 'rg foo src', 'src/a.ts:12:  foo()\nsrc/b.ts:  foo: 1\n  indented: text\n')).toEqual(['src', 'src/a.ts', 'src/b.ts'])
  expect(shellReads('Bash', "grep -rn foo 'C:\\work\\repo'", 'C:\\work\\repo\\a.ts:3:foo\r\nC:\\work\\repo\\b.ts-4-context\r\n')).toEqual(['C:\\work\\repo', 'C:\\work\\repo\\a.ts'])
  expect(shellReads('Bash', 'cat a.ts', 'b.ts:1:x\n')).toEqual(['a.ts'])
})

test('Bash: cd moves the folder of the relative paths after it, and the source of an input redirect is a read', () => {
  expect(shellReads('Bash', 'cd src; cat a.ts < ../in.txt; cat /etc/hosts ~/notes.md', '')).toEqual(['src/../in.txt', 'src/a.ts', '/etc/hosts', '~/notes.md'])
  expect(shellReads('Bash', 'cd /c/work/repo && rg -l foo', 'lib/x.ts\n')).toEqual(['/c/work/repo/lib/x.ts'])
})

test('Bash: quotes and escapes keep a name whole, and a comment, a variable and a glob name nothing', () => {
  expect(shellReads('Bash', `cat 'a b.ts' "c\\"d.ts" e\\ f.ts "a&calc&%USERNAME%.ts" # g.ts`, '')).toEqual(['a b.ts', 'c"d.ts', 'e f.ts', 'a&calc&%USERNAME%.ts'])
  expect(shellReads('Bash', 'cat "C:\\work\\repo\\a.ts" $HOME/x.ts src/*.md https://example.invalid/a.ts', '')).toEqual(['C:\\work\\repo\\a.ts'])
})

test('PowerShell: Get-Content and its aliases name their paths, also after -Path or -LiteralPath and in a list, and no value of another parameter', () => {
  const command = "Get-Content -Path src\\a.ts,src\\b.ts -TotalCount 20; gc 'C:\\work\\repo\\it''s.md'; cat -Raw notes.md; type -LiteralPath:\"a b.ts\""
  expect(shellReads('PowerShell', command, '')).toEqual(['src\\a.ts', 'src\\b.ts', "C:\\work\\repo\\it's.md", 'notes.md', 'a b.ts'])
  expect(shellReads('PowerShell', 'Get-Content $env:TEMP\\x.log; Get-Content "a`"b.ts" -Encoding utf8', '')).toEqual(['a"b.ts'])
})

test('PowerShell: Select-String takes its first word as the pattern unless -Pattern names it, and adds the files it prints', () => {
  expect(shellReads('PowerShell', 'Select-String -Path src\\*.ts -Pattern TODO', 'src\\a.ts:3:// TODO\r\n')).toEqual(['src\\a.ts'])
  expect(shellReads('PowerShell', 'sls TODO README.md, docs\\guide.md', '')).toEqual(['README.md', 'docs\\guide.md'])
  expect(shellReads('PowerShell', 'Get-ChildItem -Recurse | Select-String foo', '\r\ndocs\\x.md:1:foo\r\n')).toEqual(['docs\\x.md'])
})

test('PowerShell: Set-Location moves the folder of the relative paths after it, and rg and grep read as they do in Bash', () => {
  expect(shellReads('PowerShell', 'Set-Location src; Get-Content a.ts | Out-Null; & rg.exe -l foo', 'b.ts\r\n')).toEqual(['src/a.ts', 'src/b.ts'])
  expect(shellReads('PowerShell', 'grep -n foo lib\\x.ts | Out-File hits.txt', '')).toEqual(['lib\\x.ts'])
})

test('a command that reads no file names none, and at most 60 paths come back', () => {
  expect(shellReads('Bash', 'npm run build && git status && ls src && echo a > b.ts', 'src/a.ts:1:x\n')).toEqual([])
  expect(shellReads('PowerShell', 'Get-Date; Get-ChildItem src', '')).toEqual([])
  expect(shellReads('Bash', `cat ${Array.from({ length: 80 }, (_, i) => `f${i}.ts`).join(' ')}`, '')).toHaveLength(60)
})

test('Bash: rg --files lists file names without reading them, so neither the files it prints nor the paths it names count', () => {
  expect(shellReads('Bash', 'rg --files src', 'src/a.ts\nsrc/b.ts\n')).toEqual([])
  expect(shellReads('Bash', 'rg --files -g "*.ts" src/a.ts', 'src/a.ts\n')).toEqual([])
  expect(shellReads('Bash', 'rg --files | grep test', 'tests/a.test.ts\n')).toEqual([])
  expect(shellReads('Bash', 'rg --files-with-matches foo src', 'src/a.ts\n')).toEqual(['src', 'src/a.ts'])
})

test('Bash: a count of matches names each file it prints before the colon and the count', () => {
  expect(shellReads('Bash', 'rg -c TODO src', 'src/a.ts:2\nsrc/b.ts:3\n')).toEqual(['src', 'src/a.ts', 'src/b.ts'])
  expect(shellReads('Bash', 'rg --count TODO', 'C:\\work\\repo\\a.ts:1\n')).toEqual(['C:\\work\\repo\\a.ts'])
  expect(shellReads('Bash', 'grep -r -c TODO src', 'src/a.ts:2\nsrc/b.ts:0\n')).toEqual(['src', 'src/a.ts', 'src/b.ts'])
  expect(shellReads('Bash', 'grep -c TODO src/a.ts', '2\n')).toEqual(['src/a.ts'])
})

test('Bash: a command after && counts only when the call succeeded, one after || or inside if, while, until, for or case never, since it may not have run', () => {
  expect(shellReads('Bash', 'false && cat PLAN.md', '', false)).toEqual([])
  expect(shellReads('Bash', 'cd src && cat a.ts', '', false)).toEqual([])
  expect(shellReads('Bash', 'cd src &&\n  cat a.ts | head -n 2', '')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'test -f nope || cat PLAN.md', '')).toEqual([])
  expect(shellReads('Bash', 'cat a.ts missing.ts || echo gone', '', false)).toEqual(['a.ts', 'missing.ts'])
  expect(shellReads('Bash', 'git status && (cat a.ts; cat b.ts) | cat - c.ts', '', false)).toEqual([])
  expect(shellReads('Bash', 'if [ -f a.ts ]; then\n  cat a.ts\nfi; cat b.ts', '')).toEqual(['b.ts'])
  expect(shellReads('Bash', 'while read name; do cat x.ts; done < list.txt', '')).toEqual(['list.txt'])
  expect(shellReads('Bash', 'case "$1" in a) cat a.ts ;; esac; cat b.ts', '')).toEqual(['b.ts'])
})

test('Bash: a cd that may not have run leaves the folder of the relative paths after it unknown, and those paths count nothing', () => {
  expect(shellReads('Bash', 'test -d src && cd src; cat a.ts /etc/hosts', '', false)).toEqual(['/etc/hosts'])
  expect(shellReads('Bash', 'test -d src && cd src; cat a.ts', '')).toEqual([])
  expect(shellReads('Bash', 'test -d src && cd src && cat a.ts', '')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'false || cd src; cat a.ts; cd /c/work/repo && cat b.ts', '')).toEqual(['/c/work/repo/b.ts'])
})

test('PowerShell: a command inside a block {...} never counts, since an if, a loop or a catch may not run it, and && and || work as in Bash', () => {
  expect(shellReads('PowerShell', 'if ($false) { Get-Content PLAN.md }', '')).toEqual([])
  expect(shellReads('PowerShell', 'if (Test-Path a.ts) { Get-Content a.ts }; Get-Content b.ts', '')).toEqual(['b.ts'])
  expect(shellReads('PowerShell', 'Get-ChildItem | ForEach-Object { Get-Content x.ts } | Select-String foo', 'foo\r\n')).toEqual([])
  expect(shellReads('PowerShell', 'Set-Location src && Get-Content a.ts', '', false)).toEqual([])
  expect(shellReads('PowerShell', 'Get-Content a.ts || Get-Content b.ts', '')).toEqual(['a.ts'])
})

test('Bash: a list flag inside a group of short flags, as grep -rl and rg -il write it, makes the search a listing, a value flag that ends a group takes the next word, and -L of rg follows links', () => {
  expect(shellReads('Bash', 'grep -rl foo src', 'src/a.ts\nsrc/b.ts\n')).toEqual(['src', 'src/a.ts', 'src/b.ts'])
  expect(shellReads('Bash', 'grep -ril foo src', 'src/a.ts\n')).toEqual(['src', 'src/a.ts'])
  expect(shellReads('Bash', 'grep -lr foo src', 'src/a.ts\n')).toEqual(['src', 'src/a.ts'])
  expect(shellReads('Bash', 'rg -il foo', 'src/a.ts\nsrc/b.ts\n')).toEqual(['src/a.ts', 'src/b.ts'])
  expect(shellReads('Bash', 'grep -rA 2 foo src/a.ts', '')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'grep -rA2 foo src/a.ts', '')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'grep -ie foo -e bar src/a.ts', '')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'rg -L foo', 'src/a.ts:  foo\n')).toEqual(['src/a.ts'])
})

test('Bash: the lines of a heredoc are text, not commands: they name no file and open no block, and the commands after the heredoc count', () => {
  expect(shellReads('Bash', "cat > run.sh <<'EOF'\n#!/bin/sh\ncat config.json\nsort the files in README.md\nEOF", '')).toEqual([])
  expect(shellReads('Bash', "cat > notes.md <<'EOF'\nmore details in docs/guide.md\nEOF\ncat notes.md", '')).toEqual(['notes.md'])
  expect(shellReads('Bash', "cat > n.md <<EOF\nfor now this is fine\nif you need it\ndon't do this\nEOF\ncat a.ts", '')).toEqual(['a.ts'])
  expect(shellReads('Bash', 'cat <<-END > x.md; cat a.ts\n\tcat b.ts\n\tEND\ncat c.ts', '')).toEqual(['a.ts', 'c.ts'])
  expect(shellReads('Bash', 'cat <<A <<"B"\ncat a.ts\nA\ncat b.ts\nB\ncat c.ts', '')).toEqual(['c.ts'])
  expect(shellReads('Bash', 'cat <<< "x" b.ts; echo "<<EOF"\ncat c.ts', '')).toEqual(['b.ts', 'c.ts'])
})

test("PowerShell: the lines of a here-string are text: an apostrophe in them closes no quote, and the commands after it count", () => {
  expect(shellReads('PowerShell', "@'\ndon't read Get-Content x.ts\n'@ | Set-Content notes.md; Get-Content a.ts", '')).toEqual(['a.ts'])
  expect(shellReads('PowerShell', '$t = @"\nit\'s "quoted"\n"@\nGet-Content b.ts', '')).toEqual(['b.ts'])
})

test('Bash: a cd inside a subshell (...) or $(...) stays inside it, popd and cd - move back, and in PowerShell Pop-Location does while parentheses keep Set-Location', () => {
  expect(shellReads('Bash', '(cd hooks; cat track.ts); cat PLAN.md', '')).toEqual(['hooks/track.ts', 'PLAN.md'])
  expect(shellReads('Bash', 'x=$(cd src; pwd); cat a.ts', '')).toEqual(['a.ts'])
  expect(shellReads('Bash', '(cd a; (cd b; cat x.ts); cat y.ts); cat z.ts', '')).toEqual(['a/b/x.ts', 'a/y.ts', 'z.ts'])
  expect(shellReads('Bash', '(cd src; rg -l foo); cat a.ts > copy.ts', 'b.ts\n')).toEqual(['a.ts', 'src/b.ts'])
  expect(shellReads('Bash', 'pushd hooks; cat track.ts; popd; cat README.md', '')).toEqual(['hooks/track.ts', 'README.md'])
  expect(shellReads('Bash', 'cd hooks; cd -; cat README.md', '')).toEqual(['README.md'])
  expect(shellReads('Bash', 'cd -; cat README.md /etc/hosts', '')).toEqual(['/etc/hosts'])
  expect(shellReads('Bash', 'cd -P hooks; cat track.ts', '')).toEqual(['hooks/track.ts'])
  expect(shellReads('PowerShell', 'Push-Location src; Get-Content a.ts; Pop-Location; Get-Content b.ts', '')).toEqual(['src/a.ts', 'b.ts'])
  expect(shellReads('PowerShell', '(Set-Location src); Get-Content a.ts; Set-Location -Path lib; Get-Content b.ts', '')).toEqual(['src/a.ts', 'src/lib/b.ts'])
})

test('Bash: a command after && counts only when the call succeeded and no || and no other command follows it, since the success of the call then shows that it ran', () => {
  expect(shellReads('Bash', 'false && cat PLAN.md || true', '')).toEqual([])
  expect(shellReads('Bash', 'test -d src && cat a.ts; echo done', '')).toEqual([])
  expect(shellReads('Bash', 'false && cat a.ts &', '')).toEqual([])
  expect(shellReads('Bash', 'cd src && cat a.ts && cat b.ts | head -n 1', '')).toEqual(['src/a.ts', 'src/b.ts'])
  expect(shellReads('Bash', 'test -d src && (cat a.ts; cat b.ts)', '')).toEqual(['b.ts'])
  expect(shellReads('Bash', 'test -d x && (cat a.ts); cat b.ts', '', false)).toEqual(['b.ts'])
  expect(shellReads('Bash', '(test -d x && cat a.ts); echo done', '')).toEqual([])
})

test('a search that reads piped text names no file it prints, and one that names a path or searches the folder does', () => {
  expect(shellReads('Bash', "printf 'hooks/track.ts: needle\n' | rg needle", 'hooks/track.ts: needle\n')).toEqual([])
  expect(shellReads('Bash', 'cat a.ts | grep -n foo', 'b.ts:1:foo\n')).toEqual(['a.ts'])
  expect(shellReads('PowerShell', 'Get-Content a.ts | rg foo', 'b.ts:1:foo\r\n')).toEqual(['a.ts'])
  expect(shellReads('Bash', 'git log | grep -r foo', 'src/a.ts:foo\n')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'echo x | rg foo src', 'src/a.ts:foo\n')).toEqual(['src', 'src/a.ts'])
  expect(shellReads('Bash', 'rg -n foo | head -n 3', 'src/a.ts:1:foo\n')).toEqual(['src/a.ts'])
})

test('Bash: the body of a function runs only when something calls it, so it names no file, while a group { ...; } runs in place and its cd stays', () => {
  expect(shellReads('Bash', 'f() {\ncat src/a.ts\n}\nprintf done', '')).toEqual([])
  expect(shellReads('Bash', 'function f {\n  cat src/a.ts\n}\ncat b.ts', '')).toEqual(['b.ts'])
  expect(shellReads('Bash', 'function f() {\n  cd src\n}\ncat b.ts /etc/hosts', '')).toEqual(['/etc/hosts'])
  expect(shellReads('Bash', 'f()\n{\n  cat a.ts\n}; f; cat b.ts', '')).toEqual(['b.ts'])
  expect(shellReads('Bash', 'f() { cat a.ts; }; cat b.ts', '')).toEqual(['b.ts'])
  expect(shellReads('Bash', '{ cd src; cat a.ts; }; cat b.ts', '')).toEqual(['src/a.ts', 'src/b.ts'])
  expect(shellReads('Bash', 'echo { a; cat b.ts', '')).toEqual(['b.ts'])
})

test('Bash: a cd after then, do, else, { or builtin is a cd, and one inside an if or a loop leaves the folder unknown', () => {
  expect(shellReads('Bash', 'if [ -d packages/web ]; then cd packages/web; fi; cat package.json', '')).toEqual([])
  expect(shellReads('Bash', 'for d in a; do cd $d; done; cat package.json', '')).toEqual([])
  expect(shellReads('Bash', 'if false; then :; else cd lib; fi; cat package.json', '')).toEqual([])
  expect(shellReads('Bash', '{ cd packages/web; cat package.json; }', '')).toEqual(['packages/web/package.json'])
  expect(shellReads('Bash', 'builtin cd sub; cat package.json', '')).toEqual(['sub/package.json'])
  expect(shellReads('Bash', 'cd $DIR; cat a.ts /etc/hosts', '')).toEqual(['/etc/hosts'])
  expect(shellReads('Bash', 'if cat a.ts; then cat b.ts; fi', '')).toEqual(['a.ts'])
})

test('Bash: << inside $((...)) or ((...)) shifts a number and starts no heredoc, so the lines after it count', () => {
  expect(shellReads('Bash', 'echo $((1<<2))\ncat a.ts', '')).toEqual(['a.ts'])
  expect(shellReads('Bash', 'x=$((x << n))\ncat a.ts', '')).toEqual(['a.ts'])
  expect(shellReads('Bash', '((y = 1<<3))\ncat a.ts', '')).toEqual(['a.ts'])
  expect(shellReads('Bash', 'echo $((1<<2)); cat <<EOF\ncat b.ts\nEOF\ncat c.ts', '')).toEqual(['c.ts'])
})

test('Linux and macOS: a name that starts with a drive letter or a backslash is relative, so a cd before it moves it; on Windows it is absolute', () => {
  try {
    useWindows(false)
    expect(shellReads('Bash', "cd src; cat 'C:/a.ts' '\\a.ts' /etc/hosts ~/n.md", '')).toEqual(['src/C:/a.ts', 'src/\\a.ts', '/etc/hosts', '~/n.md'])
    useWindows(true)
    expect(shellReads('Bash', "cd src; cat 'C:/a.ts' '\\a.ts' /etc/hosts ~/n.md", '')).toEqual(['C:/a.ts', '\\a.ts', '/etc/hosts', '~/n.md'])
  } finally {
    useWindows(true)
  }
})

test('the files a search prints count only when no other command of the call prints to the output, since a line of another command can look like a match', () => {
  expect(shellReads('Bash', "rg needle src/a.ts; printf 'src/b.ts:1:example\\n'", 'src/b.ts:1:example\n')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'grep -rn foo src && git log --stat', 'src/b.ts:12:changed\n')).toEqual(['src'])
  expect(shellReads('Bash', 'rg -l foo; cat notes.txt', 'src/a.ts\nsrc/b.ts\n')).toEqual(['notes.txt'])
  expect(shellReads('Bash', 'rg -l foo | wc -l', '2\n')).toEqual([])
  expect(shellReads('Bash', 'rg -l foo src > hits.txt; cat hits.txt', 'src/a.ts\n')).toEqual(['src', 'hits.txt'])
  expect(shellReads('Bash', 'echo start; rg -l foo', 'start\nsrc/a.ts\n')).toEqual([])
  expect(shellReads('Bash', 'cd -; rg -l foo', '/c/old\nsrc/a.ts\n')).toEqual([])
  expect(shellReads('Bash', 'cd src && rg -l foo | sort | head -n 5', 'a.ts\n')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'x=$(git log -1); rg -l foo', 'a.ts\n')).toEqual(['a.ts'])
  expect(shellReads('Bash', 'rg -l foo 2>/dev/null; true', 'a.ts\n')).toEqual(['a.ts'])
  expect(shellReads('PowerShell', 'Get-Content a.ts; Select-String -Path b.ts -Pattern foo', 'c.ts:1:foo\r\n')).toEqual(['a.ts', 'b.ts'])
})

test('a search names the files it prints only under the paths it searches, since grep and rg print the lines of a single file without its name', () => {
  expect(shellReads('Bash', 'grep foo src/a.ts', 'README.md: see foo\n')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'rg foo src/a.ts', 'README.md: see foo\n')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'grep -n foo src/a.ts', '3:foo: bar\n')).toEqual(['src/a.ts'])
  expect(shellReads('Bash', 'rg -n foo src/a.ts ./lib/', 'src/a.ts:1:foo\n./lib/b.ts:2:foo\nREADME.md:3:foo\n')).toEqual(['src/a.ts', './lib/', './lib/b.ts'])
  expect(shellReads('Bash', 'grep -n foo src/*.ts', 'src/a.ts:1:foo\nREADME.md:2:foo\n')).toEqual(['src/a.ts'])
  expect(shellReads('PowerShell', 'rg -n foo src', 'src\\a.ts:1:foo\r\nsrcx.ts:1:foo\r\n')).toEqual(['src', 'src\\a.ts'])
})

test('PowerShell: Select-String that reads piped text names no file it prints, and one that gets the files of Get-ChildItem does', () => {
  expect(shellReads('PowerShell', 'Get-Content a.ts | Select-String foo', 'README.md: see foo\r\n')).toEqual(['a.ts'])
  expect(shellReads('PowerShell', 'Get-ChildItem | Get-Content | Select-String foo', 'README.md:1:foo\r\n')).toEqual([])
  expect(shellReads('PowerShell', 'Get-ChildItem -Recurse -Filter *.md | Where-Object Length -gt 0 | Select-String foo | Select-Object -First 5', 'docs\\x.md:1:foo\r\n')).toEqual(['docs\\x.md'])
})

test('Bash: a search that reads a file through < or the text of a heredoc names no file it prints, since grep and rg print the lines of their input without a name', () => {
  expect(shellReads('Bash', 'grep needle < doc.txt', 'src/other.ts:1:needle\n')).toEqual(['doc.txt'])
  expect(shellReads('Bash', 'rg -n needle <doc.txt', 'src/other.ts:1:needle\n')).toEqual(['doc.txt'])
  expect(shellReads('Bash', "grep needle <<'EOF'\nsrc/other.ts:1:needle\nEOF", 'src/other.ts:1:needle\n')).toEqual([])
  expect(shellReads('Bash', "grep needle <<< 'src/other.ts:1:needle'", 'src/other.ts:1:needle\n')).toEqual([])
  expect(shellReads('Bash', 'cat doc.txt | grep needle', 'src/other.ts:1:needle\n')).toEqual(['doc.txt'])
  expect(shellReads('Bash', 'grep -rn needle < doc.txt', 'src/other.ts:1:needle\n')).toEqual(['doc.txt', 'src/other.ts'])
  expect(shellReads('Bash', 'cat doc.txt | grep -n needle src/*.ts', 'src/a.ts:1:needle\n')).toEqual(['doc.txt', 'src/a.ts'])
})

test('Bash: a function whose body is a subshell (...) only defines the function, so it names no file, and a subshell that is no body runs', () => {
  expect(shellReads('Bash', 'f() ( cat src/a.ts )', '')).toEqual([])
  expect(shellReads('Bash', 'f() (cat src/a.ts); echo hi', 'hi\n')).toEqual([])
  expect(shellReads('Bash', 'f() ( cat src/a.ts ); f; cat b.ts', '')).toEqual(['b.ts'])
  expect(shellReads('Bash', 'function f ( cat a.ts ); cat b.ts', '')).toEqual(['b.ts'])
  expect(shellReads('Bash', 'function f() (cat a.ts)\ncat b.ts', '')).toEqual(['b.ts'])
  expect(shellReads('Bash', 'f()\n(\n  cd src\n)\ncat a.ts', '')).toEqual(['a.ts'])
  expect(shellReads('Bash', '(cat src/a.ts); echo hi', 'hi\n')).toEqual(['src/a.ts'])
})

test('Windows: a search names the files it prints under a Git Bash path it searches, which the native rg gets as a Windows path, and in any case', () => {
  try {
    useWindows(true)
    expect(shellReads('Bash', 'rg -n foo /c/work/repo/src', 'C:/work/repo/src\\a.ts:1:foo\nC:/work/other/b.ts:1:foo\n')).toEqual(['/c/work/repo/src', 'C:/work/repo/src\\a.ts'])
    expect(shellReads('Bash', 'rg -n foo /tmp/x/src', 'C:/Users/me/AppData/Local/Temp/x/src\\a.ts:1:foo\nC:/Users/me/y/b.ts:1:foo\n')).toEqual(['/tmp/x/src', 'C:/Users/me/AppData/Local/Temp/x/src\\a.ts'])
    expect(shellReads('Bash', 'grep -rn foo /c/work/repo/src', '/c/work/repo/src/a.ts:1:foo\n')).toEqual(['/c/work/repo/src', '/c/work/repo/src/a.ts'])
    expect(shellReads('PowerShell', 'rg -n foo Src', 'src\\a.ts:1:foo\r\n')).toEqual(['Src', 'src\\a.ts'])
    useWindows(false)
    expect(shellReads('Bash', 'rg -n foo /c/work/repo/src', 'C:/work/repo/src\\a.ts:1:foo\n')).toEqual(['/c/work/repo/src'])
    expect(shellReads('Bash', 'rg -n foo Src', 'src/a.ts:1:foo\n')).toEqual(['Src'])
  } finally {
    useWindows(true)
  }
})

test('PowerShell: diff and sort are Compare-Object and Sort-Object, which read no file, and a Unix reader such as head or grep counts only when the call succeeded, since PowerShell has none unless a program of that name is installed', () => {
  expect(shellReads('PowerShell', 'diff src\\a.ts src\\b.ts', 'src\\b.ts =>\r\nsrc\\a.ts <=\r\n')).toEqual([])
  expect(shellReads('PowerShell', 'sort src\\a.ts', '')).toEqual([])
  expect(shellReads('PowerShell', 'head -n 5 src\\a.ts', '', false)).toEqual([])
  expect(shellReads('PowerShell', 'grep -n foo src\\a.ts', '', false)).toEqual([])
  expect(shellReads('PowerShell', 'head -n 5 src\\a.ts', 'a1\r\n')).toEqual(['src\\a.ts'])
  expect(shellReads('PowerShell', 'Get-Content src\\a.ts; head -n 1 b.ts', '', false)).toEqual(['src\\a.ts'])
  expect(shellReads('PowerShell', 'cat src\\a.ts; head -n 1 b.ts', '', false)).toEqual(['src\\a.ts'])
  expect(shellReads('Bash', 'diff a.ts b.ts; sort c.ts', '')).toEqual(['a.ts', 'b.ts', 'c.ts'])
  expect(shellReads('Bash', 'cat a.ts missing.ts', '', false)).toEqual(['a.ts', 'missing.ts'])
})

test('a command after exit, or after a Bash exec with a command, never ran, and an exit inside a subshell, a pipe, a background command or the body of a function ends only that part', () => {
  expect(shellReads('Bash', 'exit 0; cat PLAN.md', '')).toEqual([])
  expect(shellReads('Bash', 'exit 0\ncat PLAN.md', '')).toEqual([])
  expect(shellReads('Bash', 'cat README.md; exit 0; cat PLAN.md', '')).toEqual(['README.md'])
  expect(shellReads('Bash', 'true && exit; cat PLAN.md', '')).toEqual([])
  expect(shellReads('Bash', 'if [ -f x ]; then exit 1; fi; cat PLAN.md', '')).toEqual([])
  expect(shellReads('Bash', '{ exit; }; cat PLAN.md', '')).toEqual([])
  expect(shellReads('Bash', 'exit; (cat PLAN.md)', '')).toEqual([])
  expect(shellReads('Bash', 'exec cat a.ts; cat PLAN.md', '')).toEqual(['a.ts'])
  expect(shellReads('Bash', 'exec >log.txt 2>&1; cat PLAN.md', '')).toEqual(['PLAN.md'])
  expect(shellReads('Bash', '(cat a.ts; exit; cat b.ts); cat PLAN.md', '')).toEqual(['a.ts', 'PLAN.md'])
  expect(shellReads('Bash', 'x=$(exit 1); cat PLAN.md', '')).toEqual(['PLAN.md'])
  expect(shellReads('Bash', 'echo x | exit; exit 0 | true; exit & cat PLAN.md', '')).toEqual(['PLAN.md'])
  expect(shellReads('Bash', 'f() { exit 1; }; cat PLAN.md', '')).toEqual(['PLAN.md'])
  expect(shellReads('Bash', 'return 0; cat PLAN.md', '')).toEqual(['PLAN.md'])
  expect(shellReads('PowerShell', 'Get-Content a.ts; exit; Get-Content PLAN.md', '')).toEqual(['a.ts'])
  expect(shellReads('PowerShell', 'return; Get-Content PLAN.md', '')).toEqual([])
  expect(shellReads('PowerShell', 'if (Test-Path x) { exit 1 }; Get-Content PLAN.md', '')).toEqual([])
  expect(shellReads('PowerShell', 'function f { exit 3 }; Get-Content PLAN.md', '')).toEqual(['PLAN.md'])
})

test('Bash: $(...) inside double quotes runs as shell, as in the commit message that Claude Code writes with a heredoc, so a quote in the text of the heredoc closes no quote, and the command around $(...) keeps its words after it', () => {
  const commit = `git commit -m "$(cat <<'EOF'\nSupport 27" monitors in the layout\ncat README.md now documents the width\nEOF\n)"`
  expect(shellReads('Bash', commit, '[main 1a2b3c] Support\n 1 file changed\n')).toEqual([])
  expect(shellReads('Bash', `gh pr create --title x --body "$(cat <<'EOF'\nDon't read 3" files\ngrep -n foo src/a.ts\nEOF\n)"`, '')).toEqual([])
  expect(shellReads('Bash', `git commit -m "$(cat <<'EOF'\nfix\nEOF\n)" && cat PLAN.md`, '')).toEqual(['PLAN.md'])
  expect(shellReads('Bash', 'grep "$(cat pattern.txt)" src/a.ts', '')).toEqual(['pattern.txt', 'src/a.ts'])
  expect(shellReads('Bash', 'grep $(cat pattern.txt) src/a.ts', '')).toEqual(['pattern.txt', 'src/a.ts'])
  expect(shellReads('Bash', 'echo "x $(cd src; cat a.ts) y"; cat b.ts', '')).toEqual(['src/a.ts', 'b.ts'])
  expect(shellReads('Bash', 'echo "\\$(cat a.ts)" \'$(cat b.ts)\' "$((1 + 2))"', '')).toEqual([])
})

test('PowerShell: a Unix reader counts only in the last statement of a call that succeeded, since a missing program fails only its own statement and the call ends with the exit code of its last one', () => {
  expect(shellReads('PowerShell', 'grep foo a.ts; Get-Location', '')).toEqual([])
  expect(shellReads('PowerShell', 'head -n 5 a.ts; Get-Date', '')).toEqual([])
  expect(shellReads('PowerShell', 'wc -l a.ts\necho x', '')).toEqual([])
  expect(shellReads('PowerShell', 'grep -n foo a.ts || Get-Date', '')).toEqual([])
  expect(shellReads('PowerShell', 'Get-Location; grep -n foo a.ts', '')).toEqual(['a.ts'])
  expect(shellReads('PowerShell', 'Set-Location src; grep -n foo a.ts | Select-Object -First 3', '')).toEqual(['src/a.ts'])
  expect(shellReads('PowerShell', 'grep -n foo a.ts && Get-Date', '')).toEqual(['a.ts'])
  expect(shellReads('PowerShell', 'Get-Content b.ts; Get-Date', '')).toEqual(['b.ts'])
})
