import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];
class Exit2 { line: string; constructor(line: string) { this.line = line; } }
class Fail { code: string; path: string; constructor(code: string, path: string) { this.code = code; this.path = path; } }
const blank = (s: string) => s.trim() === '';
function patchLines(text: string): string[] {
  if (text === '') return [];
  const a = text.split('\n');
  if (text.endsWith('\n')) a.pop();
  return a.map(x => x.endsWith('\r') ? x.slice(0, -1) : x);
}
function safe(p: string): boolean { return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every(s => s !== '' && s !== '.' && s !== '..'); }
class Tree {
  private orig = new Map<string, string | null>();
  now = new Map<string, string | null>();
  moves: Array<{ from: string; to: string }> = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) { let v: string | null = null; try { if (statSync(p).isFile()) v = readFileSync(p, 'utf8'); } catch {} this.orig.set(p, v); }
    return this.orig.get(p)!;
  }
  get(p: string): string | null { return this.now.has(p) ? this.now.get(p)! : this.original(p); }
}
type Edit = (tree: Tree, strict: boolean) => void;
function linesOf(s: string): { lines: string[]; final: boolean; br: string } {
  if (s === '') return { lines: [], final: false, br: '\n' };
  const br = s.indexOf('\n') > 0 && s[s.indexOf('\n') - 1] === '\r' ? '\r\n' : '\n';
  const a = s.split(br), final = s.endsWith(br);
  if (final) a.pop();
  return { lines: a, final, br };
}
function render(a: string[], br: string, final: boolean): string { return a.length ? a.join(br) + (final ? br : '') : ''; }
function tierMatches(file: string[], old: string[], strict: boolean): { tier: number; at: number[] } | null {
  if (!old.length) return { tier: 0, at: [] };
  const norm = [(s: string) => s, (s: string) => s.replace(/[ \t]+$/g, ''), (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, '')];
  for (let t = 0; t <= (strict ? 0 : 2); t++) {
    const f = file.map(norm[t]!), o = old.map(norm[t]!); const at: number[] = [];
    for (let i = 0; i + old.length <= file.length; i++) if (o.every((x, j) => f[i + j] === x)) at.push(i);
    if (at.length) return { tier: t, at };
  }
  return null;
}
function reindent(line: string, p: string, f: string): string { return line !== '' && !/^\s+$/.test(line) && line.startsWith(p) ? f + line.slice(p.length) : line; }
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (t: Tree): string => { if (!safe(p)) throw new Fail('unsafe', p); const x = t.get(p); if (x === null) throw new Fail('missing', p); return x; };
  if (o.command === 'create' && typeof o.file_text === 'string') return t => { if (!safe(p)) throw new Fail('unsafe', p); if (t.get(p) !== null) throw new Fail('exists', p); t.now.set(p, o.file_text as string); };
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const old = o.old_str, neu = (o.new_str as string | undefined) ?? '';
    return t => { const before = exists(t), crlf = before.indexOf('\n') > 0 && before[before.indexOf('\n') - 1] === '\r'; const lf = (s: string) => crlf ? s.replaceAll('\r\n', '\n') : s; const src = lf(before), needle = lf(old); let n = 0, at = -1; for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) { n++; at = i; } if (!n) throw new Fail('no-match', p); if (n > 1) throw new Fail('ambiguous', p); const out = src.slice(0, at) + lf(neu) + src.slice(at + needle.length); t.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out); };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const at = o.insert_line, add = patchLines(o.new_str);
    return t => { const before = exists(t), d = linesOf(before); if (at < 0 || at > d.lines.length) throw new Fail('no-match', p); d.lines.splice(at, 0, ...add); t.now.set(p, render(d.lines, d.br, d.final)); };
  }
  return null;
}
function jsonEdits(text: string, ls: string[]): Edit[] {
  const first = ls.findIndex(x => !blank(x)); if (first < 0) throw new Exit2('error: parse 1'); const out: Edit[] = [];
  if (ls[first]!.trimStart().startsWith('[')) { let v: unknown; try { v = JSON.parse(text); } catch { throw new Exit2(`error: parse ${first + 1}`); } if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`); for (const x of v) { const e = jsonEdit(x); if (!e) throw new Exit2(`error: parse ${first + 1}`); out.push(e); } return out; }
  ls.forEach((line, i) => { if (blank(line)) return; let e: Edit | null = null; try { e = jsonEdit(JSON.parse(line)); } catch {} if (!e) throw new Exit2(`error: parse ${i + 1}`); out.push(e); }); return out;
}
function detect(ls: string[]): string | null {
  const first = ls.findIndex(x => !blank(x)); if (first < 0) return null;
  if (ls[first]!.trim() === '*** Begin Patch') return 'v4a';
  if ('[{'.includes(ls[first]!.trimStart()[0] ?? '\0')) return 'json';
  if (ls.some(x => x.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (ls.some((x, i) => x.startsWith('diff --git ') || (x.startsWith('--- ') && (ls[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}
function paths(p: string): string { return p.replace(/^[ab]\//, ''); }
type Hunk = { a: number; old: string[]; neu: string[]; added: string[]; context: Array<{ oi: number; ni: number }>; noNl: boolean; addNoNl: boolean };
function parseUnified(ls: string[]): Edit[] {
  type Sec = { line: number; old: string | null; neu: string | null; create: boolean; del: boolean; hunks: Hunk[] };
  const secs: Sec[] = []; let sec: Sec | null = null; let i = 0, awaitingHeader = false;
  const start = (n: number) => { sec = { line: n, old: null, neu: null, create: false, del: false, hunks: [] }; secs.push(sec); };
  while (i < ls.length) {
    const l = ls[i]!;
    if (l.startsWith('diff --git ')) { const m = /^diff --git a\/(.+) b\/(.+)$/.exec(l); if (!m) throw new Exit2(`error: parse ${i + 1}`); start(i + 1); sec!.old = m[1]!; sec!.neu = m[2]!; awaitingHeader = true; i++; continue; }
    if (l.startsWith('--- ') && (ls[i + 1] ?? '').startsWith('+++ ')) { if (!awaitingHeader) start(i + 1); sec!.old = pathHeader(l.slice(4)); sec!.neu = pathHeader(ls[i + 1]!.slice(4)); awaitingHeader = false; i += 2; continue; }
    if (l.startsWith('--- ') && sec && sec.hunks.length === 0) throw new Exit2(`error: parse ${i + 2}`);
    if (l.startsWith('@@')) {
      if (sec && (sec.del || sec.neu === '/dev/null')) {
        i++;
        while (i < ls.length && !ls[i]!.startsWith('diff --git ') && !(ls[i]!.startsWith('--- ') && (ls[i + 1] ?? '').startsWith('+++ '))) i++;
        continue;
      }
      const m = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(l); if (!m || !sec) throw new Exit2(`error: parse ${i + 1}`);
      const h: Hunk = { a: Number(m[1]), old: [], neu: [], added: [], context: [], noNl: false, addNoNl: false }; i++; let trailingEmpty = 0;
      let lastNoNlEligible = false, lastWasAdd = false;
      while (i < ls.length && (ls[i] === '' || /^[ +\\-]/.test(ls[i]!)) && !ls[i]!.startsWith('diff --git ') && !(ls[i]!.startsWith('--- ') && (ls[i + 1] ?? '').startsWith('+++ '))) {
        const b = ls[i]!; if (b.startsWith('\\')) { h.noNl = lastNoNlEligible; h.addNoNl = lastWasAdd; i++; continue; }
        h.noNl = false; h.addNoNl = false;
        if (b === '' || b[0] === ' ') { const s = b === '' ? '' : b.slice(1); const oi = h.old.length, ni = h.neu.length; h.old.push(s); h.neu.push(s); h.context.push({ oi, ni }); if (b === '') trailingEmpty++; else trailingEmpty = 0; }
        else if (b[0] === '-') { h.old.push(b.slice(1)); trailingEmpty = 0; } else if (b[0] === '+') { h.neu.push(b.slice(1)); h.added.push(b.slice(1)); trailingEmpty = 0; }
        lastNoNlEligible = b === '' || b[0] === ' ' || b[0] === '+';
        lastWasAdd = b[0] === '+';
        i++;
      }
      while (trailingEmpty-- > 0) { h.old.pop(); h.neu.pop(); h.context.pop(); }
      while (h.old.length === 0 && h.neu.length === 0 && i < ls.length && ls[i] === '') i++;
      sec.hunks.push(h); continue;
    }
    if (sec && l.startsWith('new file mode ')) sec.create = true;
    if (sec && l.startsWith('deleted file mode ')) sec.del = true;
    if (sec && l.startsWith('rename from ')) sec.old = l.slice(12);
    if (sec && l.startsWith('rename to ')) sec.neu = l.slice(10);
    i++;
  }
  if (!secs.length) throw new Exit2('error: parse 1');
  return secs.map(s => (tree, strict) => {
    let oldPath = s.old, newPath = s.neu;
    if (oldPath === null) oldPath = newPath; if (newPath === null) newPath = oldPath;
    if (s.create) oldPath = null; if (s.del) newPath = null;
    if (oldPath === '/dev/null') oldPath = null; if (newPath === '/dev/null') newPath = null;
    const op = oldPath, np = newPath;
    for (const p of [op, np]) if (p !== null && !safe(p)) throw new Fail('unsafe', p);
    if (op === null) { if (np === null || tree.get(np) !== null) throw new Fail(np === null ? 'unsafe' : 'exists', np ?? ''); const adds = s.hunks.flatMap(h => h.added); const lastAddedHunk = [...s.hunks].reverse().find(h => h.added.length > 0); tree.now.set(np, render(adds, '\n', !lastAddedHunk?.addNoNl)); return; }
    const src = tree.get(op); if (src === null) throw new Fail('missing', op);
    if (np !== null && np !== op && tree.get(np) !== null) throw new Fail('exists', np);
    if (np === null) { tree.now.set(op, null); return; }
    const d = linesOf(src); let arr = d.lines.slice(), delta = 0, forceFinal: boolean | null = null;
    for (const h of s.hunks) {
      if (!h.old.length) { const at = Math.min(Math.max(h.a + delta, 0), arr.length); arr.splice(at, 0, ...h.neu); delta += h.neu.length; if (at === arr.length - h.neu.length && h.noNl) forceFinal = false; else if (at === arr.length - h.neu.length) forceFinal = true; continue; }
      const m = tierMatches(arr, h.old, strict); if (!m) throw new Fail('no-match', op);
      const aim = h.a - 1 + delta; const at = m.at.reduce((x, y) => Math.abs(y - aim) < Math.abs(x - aim) ? y : x);
      const f = arr[at]!.match(/^[ \t]*/)?.[0] ?? '', pref = h.old[0]!.match(/^[ \t]*/)?.[0] ?? '';
      const neu = h.neu.map((x, j) => { const c = h.context.find(z => z.ni === j); return c ? arr[at + c.oi]! : m.tier === 2 ? reindent(x, pref, f) : x; });
      arr.splice(at, h.old.length, ...neu); delta += neu.length - h.old.length;
      if (at + h.old.length === arr.length || at + h.old.length === arr.length + (h.old.length - neu.length)) forceFinal = h.noNl ? false : true;
    }
    const result = render(arr, d.br, forceFinal ?? d.final);
    if (op === np) tree.now.set(op, result); else { tree.now.set(op, null); tree.now.set(np, result); tree.moves.push({ from: op, to: np }); }
  });
}
function pathHeader(s: string): string { return paths(s.split('\t')[0]!.trim()); }

function parseSearch(ls: string[]): Edit[] {
  const out: Edit[] = []; let i = 0, prevEnd = -1, lastPath: string | null = null;
  while (i < ls.length) {
    if (ls[i]!.trimEnd() !== '<<<<<<< SEARCH') { i++; continue; }
    const si = i; let p: string | null = null;
    for (let j = si - 1; j > prevEnd; j--) if (!blank(ls[j]!) && !ls[j]!.trim().startsWith('```')) { p = ls[j]!.trim(); break; }
    if (p === null) p = lastPath; if (p === null) throw new Exit2(`error: parse ${si + 1}`);
    let mid = -1, end = -1; for (let j = si + 1; j < ls.length; j++) { if (mid < 0 && ls[j]!.trimEnd() === '=======') mid = j; else if (mid >= 0 && ls[j]!.trimEnd() === '>>>>>>> REPLACE') { end = j; break; } }
    if (mid < 0 || end < 0) throw new Exit2(`error: parse ${si + 1}`);
    const old = ls.slice(si + 1, mid), neu = ls.slice(mid + 1, end);
    out.push((tree, strict) => {
      if (!safe(p!)) throw new Fail('unsafe', p!);
      if (!old.length) { if (tree.get(p!) !== null) throw new Fail('exists', p!); tree.now.set(p!, render(neu, '\n', neu.length > 0)); return; }
      const src = tree.get(p!); if (src === null) throw new Fail('missing', p!); const d = linesOf(src), m = tierMatches(d.lines, old, strict); if (!m) throw new Fail('no-match', p!); if (m.at.length !== 1) throw new Fail('ambiguous', p!);
      const f = d.lines[m.at[0]!]!.match(/^[ \t]*/)?.[0] ?? '', pref = old[0]!.match(/^[ \t]*/)?.[0] ?? '';
      const vals = neu.map(x => m.tier === 2 ? reindent(x, pref, f) : x); d.lines.splice(m.at[0]!, old.length, ...vals); tree.now.set(p!, render(d.lines, d.br, d.final));
    });
    lastPath = p; prevEnd = end; i = end + 1;
  }
  if (!out.length) throw new Exit2('error: parse 1'); return out;
}

function parseV4a(ls: string[]): Edit[] {
  const first = ls.findIndex(x => !blank(x)), last = (() => { for (let i = ls.length - 1; i >= 0; i--) if (!blank(ls[i]!)) return i; return -1; })();
  if (first < 0 || ls[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first < 0 ? 1 : first + 1}`);
  if (last < 0 || ls[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${ls.length + 1}`);
  type Chunk = { anchor: string | null; eof: boolean; old: string[]; neu: string[]; ctx: Array<{ oi: number; ni: number }> };
  type Sec = { kind: string; p: string; move: string | null; chunks: Chunk[]; adds: string[]; line: number };
  const sections: Sec[] = []; let i = first + 1;
  const nextMarker = (from: number): boolean => { let j = from; while (j < last && blank(ls[j]!)) j++; return j >= last || ls[j]!.startsWith('*** Add File: ') || ls[j]!.startsWith('*** Delete File: ') || ls[j]!.startsWith('*** Update File: '); };
  while (i < last) {
    if (blank(ls[i]!)) { i++; continue; }
    const start = i, l = ls[i]!; let kind = '', p = '';
    if (l.startsWith('*** Add File: ')) { kind = 'add'; p = l.slice(14).trim(); }
    else if (l.startsWith('*** Delete File: ')) { kind = 'delete'; p = l.slice(17).trim(); }
    else if (l.startsWith('*** Update File: ')) { kind = 'update'; p = l.slice(17).trim(); }
    else throw new Exit2(`error: parse ${i + 1}`);
    i++; const s: Sec = { kind, p, move: null, chunks: [], adds: [], line: start + 1 }; sections.push(s);
    if (kind === 'add') { while (i < last && !ls[i]!.startsWith('*** ') && !(blank(ls[i]!) && nextMarker(i))) { const x = ls[i]!; if (x !== '' && !x.startsWith('+')) throw new Exit2(`error: parse ${i + 1}`); s.adds.push(x === '' ? '' : x.slice(1)); i++; } continue; }
    if (kind === 'delete') { if (i < last && !blank(ls[i]!) && !ls[i]!.startsWith('*** ')) throw new Exit2(`error: parse ${i + 1}`); continue; }
    if (ls[i]?.startsWith('*** Move to: ')) { s.move = ls[i]!.slice(13).trim(); i++; }
    while (i < last && !ls[i]!.startsWith('*** Add File: ') && !ls[i]!.startsWith('*** Delete File: ') && !ls[i]!.startsWith('*** Update File: ') && !(blank(ls[i]!) && nextMarker(i))) {
      const hline = i; let anchor: string | null = null, eof = false;
      if (ls[i]!.startsWith('@@')) { anchor = ls[i]!.slice(2).trim() || null; i++; }
      const c: Chunk = { anchor, eof, old: [], neu: [], ctx: [] };
      while (i < last && !ls[i]!.startsWith('*** End of File') && !ls[i]!.startsWith('@@') && !ls[i]!.startsWith('*** ') && !(blank(ls[i]!) && nextMarker(i))) {
        const x = ls[i]!; if (x === '' || x[0] === ' ') { const v = x === '' ? '' : x.slice(1), oi = c.old.length, ni = c.neu.length; c.old.push(v); c.neu.push(v); c.ctx.push({ oi, ni }); }
        else if (x[0] === '-') { c.old.push(x.slice(1)); }
        else if (x[0] === '+') { c.neu.push(x.slice(1)); }
        else throw new Exit2(`error: parse ${i + 1}`); i++;
      }
      if (ls[i]?.startsWith('*** End of File')) { c.eof = true; i++; }
      s.chunks.push(c);
    }
    if (kind === 'update' && !s.chunks.length && s.move === null) throw new Exit2(`error: parse ${start + 1}`);
  }
  if (!sections.length) throw new Exit2('error: parse 1');
  return sections.map(s => (tree, strict) => {
    if (!safe(s.p)) throw new Fail('unsafe', s.p);
    if (s.kind === 'add') { if (tree.get(s.p) !== null) throw new Fail('exists', s.p); tree.now.set(s.p, render(s.adds, '\n', true)); return; }
    if (s.kind === 'update' && s.move !== null && !safe(s.move)) throw new Fail('unsafe', s.move);
    const src = tree.get(s.p); if (src === null) throw new Fail('missing', s.p);
    if (s.kind === 'delete') { tree.now.set(s.p, null); return; }
    if (s.move !== null && tree.get(s.move) !== null) throw new Fail('exists', s.move);
    const d = linesOf(src), arr = d.lines.slice(); let cursor = 0;
    for (const c of s.chunks) {
      if (c.anchor !== null) { const m = tierMatches(arr.slice(cursor), [c.anchor], strict); if (!m) throw new Fail('no-match', s.p); cursor += m.at[0]! + 1; }
      let at = cursor;
      if (c.old.length) { const m = tierMatches(arr.slice(cursor), c.old, strict); if (!m) throw new Fail('no-match', s.p); const choices = m.at.map(x => x + cursor).filter(x => !c.eof || x + c.old.length === arr.length); if (!choices.length) throw new Fail('no-match', s.p); at = choices[0]!; }
      const f = arr[at]?.match(/^[ \t]*/)?.[0] ?? '', pref = c.old[0]?.match(/^[ \t]*/)?.[0] ?? '';
      const vals = c.neu.map((x, j) => { const q = c.ctx.find(z => z.ni === j); return q ? arr[at + q.oi]! : c.old.length && tierMatches(arr, c.old, strict)?.tier === 2 ? reindent(x, pref, f) : x; });
      arr.splice(at, c.old.length, ...vals); cursor = at + vals.length;
    }
    const dst = s.move ?? s.p, result = render(arr, d.br, d.final); if (dst !== s.p) { tree.now.set(s.p, null); tree.moves.push({ from: s.p, to: dst }); } tree.now.set(dst, result);
  });
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null, check = false, strict = false; const pos: string[] = []; let ended = false;
  for (const a of args) {
    if (!ended && a === '--') { ended = true; continue; }
    if (!ended && a.startsWith('-') && a !== '-') { if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9); else if (a === '--check' && !check) check = true; else if (a === '--strict' && !strict) strict = true; else return { code: 2, out: ['error: usage'] }; }
    else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  let text = ''; const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  try { text = readFileSync(file ?? 0, 'utf8'); } catch { if (file !== null) return { code: 2, out: ['error: no-patch'] }; }
  const ls = patchLines(text), kind = format === null || format === 'auto' ? detect(ls) : format; if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[]; try { edits = kind === 'json' ? jsonEdits(text, ls) : kind === 'unified' ? parseUnified(ls) : kind === 'search-replace' ? parseSearch(ls) : parseV4a(ls); if (!edits.length) throw new Exit2('error: parse 1'); } catch (e) { if (e instanceof Exit2) return { code: 2, out: [e.line] }; throw e; }
  const tree = new Tree(), fails: Fail[] = [];
  for (const e of edits) { const before = new Map(tree.now), moveCount = tree.moves.length; try { e(tree, strict); } catch (x) { if (!(x instanceof Fail)) throw x; tree.now.clear(); for (const [k, v] of before) tree.now.set(k, v); tree.moves.length = moveCount; fails.push(x); } }
  if (fails.length) return { code: 1, out: [...fails.map(f => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const movedFrom = new Set<string>(), movedTo = new Set<string>();
  const renameRows: Array<{ key: string; row: string; path: string }> = [];
  for (const m of tree.moves) if (!movedFrom.has(m.from) && !movedTo.has(m.to) && tree.original(m.from) !== null && tree.get(m.from) === null && tree.original(m.to) === null && tree.get(m.to) !== null) {
    movedFrom.add(m.from); movedTo.add(m.to); renameRows.push({ key: m.to, row: `R ${m.from} -> ${m.to}`, path: m.to });
  }
  const rows: Array<{ key: string; row: string; path: string }> = [...renameRows];
  for (const p of tree.now.keys()) { if (movedFrom.has(p) || movedTo.has(p)) continue; const was = tree.original(p), now = tree.now.get(p)!; if (was === now) continue; rows.push({ key: p, row: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}`, path: p }); }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  if (!check) for (const [p, now] of tree.now) { if (now === null) rmSync(p, { force: true }); else { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, now); } }
  return { code: 0, out: [...rows.map(x => x.row), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv) { const { runTrial } = await import('./runner.ts'); await runTrial(trialEnv); }
else { const r = run(process.argv.slice(2)); writeSync(1, r.out.map(x => `${x}\n`).join('')); process.exitCode = r.code; }
