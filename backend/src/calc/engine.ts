// Deterministic calculation engine for rule EXPRESSION lines. A restricted grammar, parsed into a tree and evaluated
// by this code only: numbers, input/step names, + − × ÷, parentheses, comparisons and a fixed list of functions.
// Nothing from a TXT file is ever executed as code.
//
//   step       := name "=" expr
//   expr       := cmp
//   cmp        := sum (("==" | "!=" | "<" | "<=" | ">" | ">=") sum)?
//   sum        := product (("+" | "-") product)*
//   product    := unary (("*" | "/") unary)*
//   unary      := "-" unary | primary
//   primary    := number | name | FUNC "(" expr ("," expr)* ")" | "(" expr ")"
//   FUNC       := MIN | MAX | ABS | ROUND | ROUNDUP | ROUNDDOWN | IF

export class CalcError extends Error {}

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

const FUNCS: Record<string, [number, number]> = { MIN: [2, 20], MAX: [2, 20], ABS: [1, 1], ROUND: [1, 2], ROUNDUP: [1, 2], ROUNDDOWN: [1, 2], IF: [3, 3] };

interface Tok { k: 'num' | 'id' | 'op'; v: string; pos: number }

function tokenize(src: string): Tok[] {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+(\.\d+)?|\.\d+)/.exec(s.slice(i));
    if (num) { out.push({ k: 'num', v: num[0], pos: i }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { out.push({ k: 'id', v: id[0], pos: i }); i += id[0].length; continue; }
    const op = /^(==|!=|<=|>=|[-+*/(),<>=])/.exec(s.slice(i));
    if (op) { out.push({ k: 'op', v: op[0], pos: i }); i += op[0].length; continue; }
    throw new CalcError(`Character "${c}" is not allowed in an expression (position ${i + 1}).`);
  }
  return out;
}

function parseExpr(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v !== undefined && t.v !== v)) throw new CalcError(`Expected "${v ?? 'a value'}" ${t ? `but found "${t.v}"` : 'at the end'} in "${src}".`);
    p++;
    return t;
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new CalcError(`Incomplete expression "${src}".`);
    if (t.k === 'num') { p++; return { t: 'num', v: Number(t.v) }; }
    if (t.v === '(') { p++; const e = cmp(); eat(')'); return e; }
    if (t.k === 'id') {
      p++;
      if (peek()?.v === '(') {
        const fn = t.v.toUpperCase();
        if (!FUNCS[fn]) throw new CalcError(`Function ${t.v} is not allowed (allowed: ${Object.keys(FUNCS).join(', ')}).`);
        p++;
        const args = [cmp()];
        while (peek()?.v === ',') { p++; args.push(cmp()); }
        eat(')');
        const [min, max] = FUNCS[fn];
        if (args.length < min || args.length > max) throw new CalcError(`${fn} takes ${min === max ? min : `${min}–${max}`} arguments.`);
        return { t: 'call', fn, args };
      }
      return { t: 'var', name: t.v };
    }
    throw new CalcError(`Unexpected "${t.v}" in "${src}".`);
  };
  const unary = (): Node => (peek()?.v === '-' ? (p++, { t: 'neg', a: unary() }) : peek()?.v === '+' ? (p++, unary()) : primary());
  const product = (): Node => {
    let a = unary();
    while (peek() && (peek().v === '*' || peek().v === '/')) { const op = eat().v; a = { t: 'bin', op, a, b: unary() }; }
    return a;
  };
  const sum = (): Node => {
    let a = product();
    while (peek() && (peek().v === '+' || peek().v === '-')) { const op = eat().v; a = { t: 'bin', op, a, b: product() }; }
    return a;
  };
  const cmp = (): Node => {
    const a = sum();
    const t = peek();
    if (t && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) { p++; return { t: 'bin', op: t.v, a, b: sum() }; }
    return a;
  };
  const tree = cmp();
  if (p < toks.length) throw new CalcError(`Unexpected "${toks[p].v}" in "${src}".`);
  return tree;
}

const names = (n: Node, out = new Set<string>()): Set<string> => {
  if (n.t === 'var') out.add(n.name);
  else if (n.t === 'neg') names(n.a, out);
  else if (n.t === 'bin') { names(n.a, out); names(n.b, out); }
  else if (n.t === 'call') n.args.forEach((a) => names(a, out));
  return out;
};

export type InputType = 'quantity' | 'percent' | 'money' | 'number' | 'multiplier';
export interface CalcInput { name: string; label: string; type: InputType; required: boolean; default?: number }
export interface CalcStep { target: string; source: string; tree: Node; uses: string[] }
export interface CalcSpec { inputs: CalcInput[]; steps: CalcStep[]; output: string; decimals?: number }

const NAME = /^[a-z_][a-z0-9_]*$/;

/** Builds a calculation spec from a rule's CALC INPUTS / EXPRESSION / CALC OUTPUT / ROUNDING RULE fields. */
export function parseSpec(fields: Record<string, string>): CalcSpec | null {
  const exprText = (fields['EXPRESSION'] ?? '').trim();
  if (!exprText) return null;
  const inputs: CalcInput[] = [];
  for (const line of (fields['CALC INPUTS'] ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [name, label, type = 'number', req = 'required'] = line.split('|').map((x) => x.trim());
    if (!NAME.test(name)) throw new CalcError(`Input name "${name}" must be lower case letters, digits and underscores.`);
    if (!['quantity', 'percent', 'money', 'number', 'multiplier'].includes(type)) throw new CalcError(`Input type "${type}" of ${name} is not known.`);
    const def = /^default\s+(-?\d+(\.\d+)?)$/i.exec(req);
    inputs.push({ name, label: label || name, type: type as InputType, required: !def && /required/i.test(req), default: def ? Number(def[1]) : undefined });
  }
  const known = new Set(inputs.map((i) => i.name));
  const steps: CalcStep[] = [];
  for (const line of exprText.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^([a-z_][a-z0-9_]*)\s*=(?!=)\s*(.+)$/.exec(line);
    if (!m) throw new CalcError(`Each EXPRESSION line must look like "name = formula": "${line}".`);
    const tree = parseExpr(m[2]);
    const uses = [...names(tree)];
    const unknown = uses.filter((u) => !known.has(u));
    if (unknown.length) throw new CalcError(`"${line}" uses ${unknown.join(', ')}, which is neither an input nor an earlier step.`);
    if (known.has(m[1]) && inputs.some((i) => i.name === m[1])) throw new CalcError(`Step "${m[1]}" would overwrite an input.`);
    steps.push({ target: m[1], source: m[2].trim(), tree, uses });
    known.add(m[1]);
  }
  const output = (fields['CALC OUTPUT'] ?? '').trim() || steps[steps.length - 1].target;
  if (!known.has(output)) throw new CalcError(`CALC OUTPUT "${output}" is not computed by the expression.`);
  const dec = /(\d+)\s*decimal/i.exec(fields['ROUNDING RULE'] ?? '');
  return { inputs, steps, output, decimals: dec ? Number(dec[1]) : undefined };
}

export interface StepResult { target: string; formula: string; substituted: string; value: number }
export interface CalcResult {
  ok: boolean;
  output: string;
  result: number | null;
  values: Record<string, number>;
  steps: StepResult[];
  inputsUsed: { name: string; label: string; value: number; defaulted: boolean }[];
  warnings: string[];
  errors: string[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12))));

function evalNode(n: Node, vals: Record<string, number>): number {
  switch (n.t) {
    case 'num': return n.v;
    case 'var': return vals[n.name];
    case 'neg': return -evalNode(n.a, vals);
    case 'bin': {
      const a = evalNode(n.a, vals), b = evalNode(n.b, vals);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) throw new CalcError('Division by zero.'); return a / b;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
      }
      throw new CalcError(`Operator ${n.op} is not supported.`);
    }
    case 'call': {
      if (n.fn === 'IF') return evalNode(n.args[0], vals) !== 0 ? evalNode(n.args[1], vals) : evalNode(n.args[2], vals);
      const a = n.args.map((x) => evalNode(x, vals));
      const places = a[1] ?? 0;
      const f = 10 ** places;
      switch (n.fn) {
        case 'MIN': return Math.min(...a);
        case 'MAX': return Math.max(...a);
        case 'ABS': return Math.abs(a[0]);
        case 'ROUND': return Math.round(a[0] * f) / f;
        case 'ROUNDUP': return Math.ceil(a[0] * f) / f;
        case 'ROUNDDOWN': return Math.floor(a[0] * f) / f;
      }
      throw new CalcError(`Function ${n.fn} is not supported.`);
    }
  }
}

/** Converts a user value to a number: accepts numbers and numeric text ("1,234.5", "5 %"). */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/,/g, '').replace(/\s*%$/, '');
  if (s === '') return null;
  if (!/^[-+]?(\d+(\.\d+)?|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  return Number(s);
}

/** Runs a spec. Never throws for bad input: problems are returned as errors and warnings. */
export function evaluate(spec: CalcSpec, raw: Record<string, unknown>): CalcResult {
  const vals: Record<string, number> = {};
  const warnings: string[] = [];
  const errors: string[] = [];
  const inputsUsed: CalcResult['inputsUsed'] = [];
  for (const inp of spec.inputs) {
    const n = toNumber(raw[inp.name]);
    if (n === null) {
      if (inp.default !== undefined) { vals[inp.name] = inp.default; inputsUsed.push({ name: inp.name, label: inp.label, value: inp.default, defaulted: true }); continue; }
      errors.push(`Missing input: ${inp.label} (${inp.name}).`);
      continue;
    }
    if (Number.isNaN(n)) { errors.push(`${inp.label} (${inp.name}) is not a number: "${String(raw[inp.name])}".`); continue; }
    if (inp.type === 'percent' && (n < 0 || n > 100)) warnings.push(`${inp.label} is ${n} %, outside 0–100 %.`);
    if ((inp.type === 'quantity' || inp.type === 'money') && n < 0) warnings.push(`${inp.label} is negative (${n}).`);
    vals[inp.name] = n;
    inputsUsed.push({ name: inp.name, label: inp.label, value: n, defaulted: false });
  }
  const steps: StepResult[] = [];
  if (!errors.length) {
    for (const st of spec.steps) {
      try {
        const v = evalNode(st.tree, vals);
        if (!Number.isFinite(v)) throw new CalcError('The result is not a finite number.');
        vals[st.target] = v;
        const substituted = st.source.replace(/\b[a-z_][a-z0-9_]*\b/g, (w) => (w in vals ? fmt(vals[w]) : w));
        steps.push({ target: st.target, formula: st.source, substituted, value: v });
      } catch (e) {
        errors.push(`Step "${st.target} = ${st.source}": ${(e as Error).message}`);
        break;
      }
    }
  }
  let result: number | null = errors.length ? null : vals[spec.output];
  if (result !== null && spec.decimals !== undefined) {
    const f = 10 ** spec.decimals;
    result = Math.round(result * f) / f;
  }
  return { ok: !errors.length, output: spec.output, result, values: vals, steps, inputsUsed, warnings, errors };
}

/** Parses "a=1, b=2 → out=3" test lines from a rule's TEST CASES field. */
export function parseTestCases(text: string | undefined): { inputs: Record<string, number>; expect: Record<string, number>; line: string }[] {
  const out: { inputs: Record<string, number>; expect: Record<string, number>; line: string }[] = [];
  for (const line of (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [lhs, rhs] = line.split(/→|->/);
    if (!rhs) continue;
    const pairs = (s: string) => Object.fromEntries(s.split(',').map((p) => p.split('=').map((x) => x.trim())).filter((p) => p.length === 2 && NAME.test(p[0])).map(([k, v]) => [k, Number(v)]));
    out.push({ inputs: pairs(lhs), expect: pairs(rhs), line });
  }
  return out;
}

export interface GeneratedCase { name: string; kind: 'standard' | 'zero' | 'minimum' | 'maximum' | 'null' | 'invalid' | 'boundary'; inputs: Record<string, unknown>; expect: string; pass: boolean; detail: string }

/** Generates and runs test cases for a spec: the rule's own examples plus zero, minimum, maximum, null, invalid and boundary cases. */
export function generateTests(spec: CalcSpec, testCases: string | undefined, tolerance = 1e-6): GeneratedCase[] {
  const out: GeneratedCase[] = [];
  const base: Record<string, unknown> = Object.fromEntries(spec.inputs.map((i) => [i.name, i.type === 'percent' ? 5 : i.type === 'multiplier' ? 1 : 10]));
  for (const tc of parseTestCases(testCases)) {
    const r = evaluate(spec, tc.inputs);
    const diffs = Object.entries(tc.expect).filter(([k, v]) => !(k in r.values) || Math.abs(r.values[k] - v) > tolerance * Math.max(1, Math.abs(v)));
    out.push({ name: tc.line, kind: 'standard', inputs: tc.inputs, expect: Object.entries(tc.expect).map(([k, v]) => `${k} = ${v}`).join(', '), pass: r.ok && !diffs.length, detail: r.ok ? (diffs.length ? diffs.map(([k, v]) => `${k}: expected ${v}, got ${r.values[k]}`).join('; ') : 'matches') : r.errors.join(' ') });
  }
  const run = (name: string, kind: GeneratedCase['kind'], inputs: Record<string, unknown>, expectOk: boolean | 'any', expect: string) => {
    const r = evaluate(spec, inputs);
    const pass = expectOk === 'any' ? true : r.ok === expectOk;
    out.push({ name, kind, inputs, expect, pass, detail: r.ok ? `${spec.output} = ${fmt(r.result as number)}${r.warnings.length ? ` (warnings: ${r.warnings.join(' ')})` : ''}` : r.errors.join(' ') });
  };
  run('Typical values', 'standard', base, true, 'a finite result');
  run('All inputs zero', 'zero', Object.fromEntries(spec.inputs.map((i) => [i.name, 0])), 'any', 'a result, or a clear error such as division by zero');
  run('Minimum (required inputs only, optional ones left to defaults)', 'minimum', Object.fromEntries(spec.inputs.filter((i) => i.required).map((i) => [i.name, i.type === 'percent' ? 0 : 1])), true, 'a finite result');
  run('Maximum (very large quantities and amounts)', 'maximum', Object.fromEntries(spec.inputs.map((i) => [i.name, i.type === 'percent' ? 99 : i.type === 'multiplier' ? 10 : 1e9])), true, 'a finite result');
  const req = spec.inputs.find((i) => i.required);
  if (req) run(`Missing ${req.label}`, 'null', { ...base, [req.name]: null }, false, `an error naming ${req.label}`);
  const first = spec.inputs[0];
  if (first) run(`${first.label} is not a number`, 'invalid', { ...base, [first.name]: 'abc' }, false, 'an error saying it is not a number');
  for (const p of spec.inputs.filter((i) => i.type === 'percent')) run(`${p.label} = 100 %`, 'boundary', { ...base, [p.name]: 100 }, 'any', 'a result, or a division-by-zero error when the formula divides by (1 − %)');
  for (const p of spec.inputs.filter((i) => i.type === 'percent')) run(`${p.label} = 0 %`, 'boundary', { ...base, [p.name]: 0 }, true, 'a finite result');
  return out;
}
