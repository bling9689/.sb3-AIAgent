// dsl.mjs — IR ⇄ テキストDSL（Python風・インデント構文・中置式）
//
//   proc "move %s"(dx) warp:            # カスタムブロック定義
//     $x += dx
//     if(x > 220):
//       set_x(220)
//   when_flag():                         # スクリプト（先頭はハット）
//     $score = 0
//     forever():
//       if(key_pressed("right arrow")):
//         call "move %s"($speed)
//       @log.append(join("score=", $score))
//
// 方針: ①式は中置 ②変数 $x / リスト @x / 引数は素の名前 ③それ以外のブロックは name(args) の統一形
//       ④IRと厳密に可逆（往復テストで保証）⑤エラーは行番号つきで、修復ループにそのまま渡せる文面にする。
import { CATALOG, md5 } from './sb3core.mjs';
const te = new TextEncoder();

export class DslError extends Error {
  constructor(msg, line) { super(line ? `line ${line}: ${msg}` : msg); this.line = line ?? null; }
}

/* ───────── 名前表 ───────── */
const ALIAS = {
  event_whenflagclicked: 'when_flag', event_whenkeypressed: 'when_key', event_whenthisspriteclicked: 'when_clicked',
  event_whenbroadcastreceived: 'when_msg', event_broadcast: 'broadcast', event_broadcastandwait: 'broadcast_wait',
  control_wait: 'wait', control_repeat: 'repeat', control_forever: 'forever', control_if: 'if', control_if_else: 'if',
  control_wait_until: 'wait_until', control_repeat_until: 'repeat_until', control_stop: 'stop',
  motion_movesteps: 'move', motion_turnright: 'turn_right', motion_turnleft: 'turn_left', motion_gotoxy: 'goto_xy', motion_goto: 'goto',
  motion_pointindirection: 'point', motion_changexby: 'change_x', motion_changeyby: 'change_y', motion_setx: 'set_x', motion_sety: 'set_y',
  motion_ifonedgebounce: 'bounce', motion_xposition: 'x_position', motion_yposition: 'y_position', motion_direction: 'direction',
  looks_say: 'say', looks_sayforsecs: 'say_for', looks_show: 'show', looks_hide: 'hide', looks_nextcostume: 'next_costume',
  looks_changesizeby: 'change_size', looks_setsizeto: 'set_size', looks_seteffectto: 'set_effect',
  sound_play: 'play_sound', sound_stopallsounds: 'stop_sounds',
  sensing_keypressed: 'key_pressed', sensing_touchingobject: 'touching', sensing_mousex: 'mouse_x', sensing_mousey: 'mouse_y',
  sensing_mousedown: 'mouse_down', sensing_timer: 'timer', sensing_resettimer: 'reset_timer', sensing_dayssince2000: 'days_since_2000',
  operator_random: 'random', operator_join: 'join', operator_mathop: 'math', operator_round: 'round', operator_letter_of: 'letter_of',
  operator_length: 'length', operator_contains: 'contains',
  control_create_clone_of: 'create_clone', control_delete_this_clone: 'delete_clone', control_start_as_clone: 'when_clone',
  data_showvariable: 'show_var', data_hidevariable: 'hide_var',
  looks_changeeffectby: 'change_effect', looks_cleargraphiceffects: 'clear_effects', looks_goforwardbackwardlayers: 'go_layers',
  looks_gotofrontback: 'go_to_layer', looks_nextbackdrop: 'next_backdrop', looks_switchbackdropto: 'switch_backdrop',
  looks_switchcostumeto: 'switch_costume', looks_thinkforsecs: 'think_for', looks_think: 'think', looks_size: 'size', looks_costumenumbername: 'costume_info',
  motion_glidesecstoxy: 'glide_xy', motion_glideto: 'glide_to', motion_pointtowards: 'point_towards', motion_setrotationstyle: 'set_rotation_style',
  sensing_answer: 'answer', sensing_askandwait: 'ask', sensing_distanceto: 'distance_to', sensing_touchingcolor: 'touching_color',
  sound_changevolumeby: 'change_volume', sound_playuntildone: 'play_sound_until_done', sound_setvolumeto: 'set_volume', sound_volume: 'volume',
  pen_stamp: 'stamp', pen_changePenColorParamBy: 'change_pen_param',
  pen_penDown: 'pen_down', pen_penUp: 'pen_up', pen_setPenSizeTo: 'set_pen_size', pen_setPenColorToColor: 'set_pen_color', pen_setPenColorParamTo: 'set_pen_param',
};
{ const seen = new Map(); for (const [op, n] of Object.entries(ALIAS)) { if (seen.has(n) && n !== 'if') throw new Error(`duplicate DSL alias "${n}" (${seen.get(n)}, ${op})`); seen.set(n, op); } }
const BY_NAME = new Map();
for (const [op, name] of Object.entries(ALIAS)) if (!BY_NAME.has(name)) BY_NAME.set(name, op);
const nameOf = (op) => ALIAS[op] ?? op;
const opOf = (name) => BY_NAME.get(name) ?? (CATALOG[name] ? name : null);
const argNames = (op) => [...Object.keys(CATALOG[op].f ?? {}), ...Object.keys(CATALOG[op].i ?? {})]; // フィールド→入力の順

// 中置演算子: [記号, 優先度, 左引数名, 右引数名]
const INFIX = {
  operator_or: ['or', 1, 'OPERAND1', 'OPERAND2'], operator_and: ['and', 2, 'OPERAND1', 'OPERAND2'],
  operator_equals: ['==', 4, 'OPERAND1', 'OPERAND2'], operator_lt: ['<', 4, 'OPERAND1', 'OPERAND2'], operator_gt: ['>', 4, 'OPERAND1', 'OPERAND2'],
  operator_add: ['+', 5, 'NUM1', 'NUM2'], operator_subtract: ['-', 5, 'NUM1', 'NUM2'],
  operator_multiply: ['*', 6, 'NUM1', 'NUM2'], operator_divide: ['/', 6, 'NUM1', 'NUM2'], operator_mod: ['%', 6, 'NUM1', 'NUM2'],
};
const INFIX_BY_SYM = Object.fromEntries(Object.entries(INFIX).map(([op, [sym, , l, r]]) => [sym, { op, l, r }]));
const NOT_PREC = 3, PRIM_PREC = 7;

/* ───────── 印字 ───────── */
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const NUM_CANON = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const q = (s) => JSON.stringify(String(s));
const nameTok = (s) => (IDENT.test(String(s)) ? String(s) : q(s));
const argRef = (s) => (IDENT.test(s) && s !== '_' && !['and', 'or', 'not'].includes(s) ? s : `%${q(s)}`);
const lit = (v) => { const s = String(v); return NUM_CANON.test(s) && String(Number(s)) === s ? s : q(s); };

function ex(v, min = 0) {
  if (v === null || v === undefined) return '_';
  if (typeof v !== 'object') return lit(v);
  if ('var' in v) return '$' + nameTok(v.var);
  if ('list' in v) return '@' + nameTok(v.list);
  if ('arg' in v) return argRef(v.arg);
  if (v.call !== undefined) throw new DslError('a custom block call cannot be used as a value');
  const a = v.args ?? {}, op = v.op;
  if (v.comment) throw new DslError(`comment on reporter "${op}" cannot be expressed`);
  if (v.mut) throw new DslError(`mutation on "${op}" cannot be expressed`);
  const inf = INFIX[op];
  if (inf) {
    const [sym, p, l, r] = inf;
    const s = `${ex(a[l], p === 4 ? p + 1 : p)} ${sym} ${ex(a[r], p + 1)}`;
    return p < min ? `(${s})` : s;
  }
  if (op === 'operator_not') { const s = `not ${ex(a.OPERAND, NOT_PREC)}`; return NOT_PREC < min ? `(${s})` : s; }
  if (op === 'data_itemoflist') return `@${nameTok(a.LIST)}[${ex(a.INDEX)}]`;
  if (op === 'data_lengthoflist') return `len(@${nameTok(a.LIST)})`;
  if (op === 'data_itemnumoflist') return `@${nameTok(a.LIST)}.index(${ex(a.ITEM)})`;
  return `${nameOf(op)}(${argNames(op).map((n) => ex(a[n])).join(', ')})`;
}

function stmt(node, ind, out) {
  if (node.comment) out.push(`${ind}#: ${q(node.comment.text)}`);
  if (node.call !== undefined) { out.push(`${ind}call ${q(node.call)}(${(node.args ?? []).map((x) => ex(x)).join(', ')})`); return; }
  const op = node.op, a = node.args ?? {}, spec = CATALOG[op];
  if (!spec) throw new DslError(`unknown opcode "${op}"`);
  if (node.mut) throw new DslError(`mutation on "${op}" cannot be expressed`);
  const L = () => '@' + nameTok(a.LIST);
  switch (op) {
    case 'data_setvariableto': out.push(`${ind}$${nameTok(a.VARIABLE)} = ${ex(a.VALUE)}`); return;
    case 'data_changevariableby': out.push(`${ind}$${nameTok(a.VARIABLE)} += ${ex(a.VALUE)}`); return;
    case 'data_addtolist': out.push(`${ind}${L()}.append(${ex(a.ITEM)})`); return;
    case 'data_deletealloflist': out.push(`${ind}${L()}.clear()`); return;
    case 'data_deleteoflist': out.push(`${ind}${L()}.delete(${ex(a.INDEX)})`); return;
    case 'data_insertatlist': out.push(`${ind}${L()}.insert(${ex(a.INDEX)}, ${ex(a.ITEM)})`); return;
    case 'data_replaceitemoflist': out.push(`${ind}${L()}[${ex(a.INDEX)}] = ${ex(a.ITEM)}`); return;
  }
  const head = `${ind}${nameOf(op)}(${argNames(op).map((n) => ex(a[n])).join(', ')})`;
  if (!spec.sub) { out.push(head); return; }
  out.push(head + ':');
  body(node.sub, ind + '  ', out);
  if (node.sub2 || op === 'control_if_else') { out.push(`${ind}else:`); body(node.sub2, ind + '  ', out); }
}
function body(nodes, ind, out) {
  if (!nodes?.length) { out.push(`${ind}pass`); return; }
  for (const n of nodes) stmt(n, ind, out);
}

/** 1ユニット(手続き定義 or スクリプト)をDSLテキストに */
export function printUnit(u) {
  const out = [];
  if (Array.isArray(u)) {
    const head = u[0], k = head.call !== undefined ? 'stack' : CATALOG[head.op]?.k;
    if (k === 'hat') {
      if (head.comment) out.push(`#: ${q(head.comment.text)}`);
      out.push(`${nameOf(head.op)}(${argNames(head.op).map((n) => ex((head.args ?? {})[n])).join(', ')}):`);
      body(u.slice(1), '  ', out);
    } else if (k === 'reporter' || k === 'boolean') {
      if (head.comment) out.push(`#: ${q(head.comment.text)}`);
      out.push(`loose ${ex({ ...head, comment: undefined })}`);
    } else { out.push('stack:'); body(u, '  ', out); }
  } else {
    if (u.comment) out.push(`#: ${q(u.comment.text)}`);
    out.push(`proc ${q(u.proc)}(${u.args.map(nameTok2).join(', ')})${u.warp ? ' warp' : ''}${u.defaults ? ` defaults=[${u.defaults.map(q).join(', ')}]` : ''}:`);
    body(u.body, '  ', out);
  }
  return out.join('\n');
}
const nameTok2 = (s) => (IDENT.test(s) && s !== '_' ? s : q(s));

/** ターゲット(ステージ/スプライト)のコード全体 */
export function printTarget(t) {
  const parts = [];
  if (t.comments?.length) parts.push(t.comments.map((c) => `#! ${q(c.text)}`).join('\n'));
  for (const p of t.procs ?? []) parts.push(printUnit(p));
  for (const s of t.scripts ?? []) parts.push(printUnit(s));
  return parts.join('\n\n') + '\n';
}

/* ───────── 字句解析 ───────── */
const RE_STR = /"(?:[^"\\]|\\.)*"/y, RE_NUM = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, RE_ID = /[\p{L}_][\p{L}\p{N}_]*/uy;
function lex(src, line) {
  const toks = []; let i = 0;
  const err = (m) => { throw new DslError(m, line); };
  const prevOperand = () => { const p = toks[toks.length - 1]; return !!p && (['num', 'str', 'abs'].includes(p.t) || (p.t === 'id' && !['and', 'or', 'not'].includes(p.v)) || (p.t === 'op' && (p.v === ')' || p.v === ']'))); };
  const match = (re) => { re.lastIndex = i; const m = re.exec(src); return m && m.index === i ? m[0] : null; };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (c === '"') {
      const m = match(RE_STR); if (!m) err('unterminated string literal');
      let v; try { v = JSON.parse(m); } catch { err(`invalid escape in string ${m.slice(0, 20)}`); }
      toks.push({ t: 'str', v }); i += m.length; continue;
    }
    if ((c === '-' && /\d/.test(src[i + 1] ?? '') && !prevOperand()) || /\d/.test(c)) {
      const neg = c === '-'; if (neg) i++;
      const m = match(RE_NUM); if (!m) err('bad number');
      toks.push({ t: 'num', v: Number((neg ? '-' : '') + m) }); i += m.length; continue;
    }
    const m = match(RE_ID);
    if (m) {
      const afterSig = toks.length && toks[toks.length - 1].t === 'sig';
      toks.push(m === '_' && !afterSig ? { t: 'abs' } : { t: 'id', v: m }); i += m.length; continue;
    }
    if (c === '$' || c === '@') { toks.push({ t: 'sig', v: c }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (two === '==' || two === '+=') { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/%<>()[],.:='.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    err(`unexpected character '${c}'`);
  }
  return toks;
}

/* ───────── 構文解析 ───────── */
const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const hint = (name) => {
  const all = [...BY_NAME.keys(), ...Object.keys(CATALOG)];
  const best = all.map((c) => [lev(name, c), c]).sort((x, y) => x[0] - y[0])[0];
  if (!best || best[0] > Math.max(2, Math.floor(name.length / 3))) return '';
  const op = opOf(best[1]);
  return ` (did you mean "${op ? nameOf(op) : best[1]}"?)`;
};

class TP { // トークン列リーダー
  constructor(toks, line) { this.t = toks; this.i = 0; this.line = line; }
  peek(k = 0) { return this.t[this.i + k]; }
  next() { return this.t[this.i++]; }
  isOp(v, k = 0) { const x = this.peek(k); return !!x && x.t === 'op' && x.v === v; }
  isId(v, k = 0) { const x = this.peek(k); return !!x && x.t === 'id' && x.v === v; }
  eatOp(v) { if (this.isOp(v)) { this.i++; return true; } return false; }
  expectOp(v) { if (!this.eatOp(v)) this.fail(`expected '${v}' but found ${this.desc()}`); }
  done() { return this.i >= this.t.length; }
  desc() { const x = this.peek(); return x ? (x.t === 'abs' ? "'_'" : `'${x.v ?? x.t}'`) : 'end of line'; }
  fail(m) { throw new DslError(m, this.line); }
}

function makeNode(name, args, p, ctx) {
  if (ctx === 'expr' && name === 'len') {
    if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || !('list' in args[0])) p.fail('len() takes one list, e.g. len(@items)');
    return { op: 'data_lengthoflist', args: { LIST: args[0].list } };
  }
  const op = opOf(name);
  if (!op) p.fail(`unknown block "${name}"${hint(name)}`);
  const spec = CATALOG[op];
  const ok = ctx === 'expr' ? ['reporter', 'boolean'] : ctx === 'hat' ? ['hat'] : ['stack', 'cap'];
  if (!ok.includes(spec.k)) p.fail(`"${name}" is a ${spec.k} block and cannot be used as ${ctx === 'expr' ? 'a value' : ctx === 'hat' ? 'a script start (use "stack:" for a headless stack)' : 'a statement'}`);
  const names = argNames(op);
  if (args.length > names.length) p.fail(`"${name}" takes ${names.length} argument(s)${names.length ? ` (${names.join(', ')})` : ''}, got ${args.length}`);
  const o = {};
  names.forEach((n, i) => {
    if (i >= args.length) return;
    let v = args[i];
    if (spec.f && n in spec.f) {
      if (v !== null && typeof v === 'object') p.fail(`argument ${i + 1} (${n}) of "${name}" must be a literal, not an expression`);
      if (v !== null) v = String(v);
    }
    o[n] = v;
  });
  return Object.keys(o).length ? { op, args: o } : { op };
}

function parseCallArgs(p) {
  p.expectOp('(');
  const args = [];
  if (!p.eatOp(')')) {
    do args.push(parseExpr(p)); while (p.eatOp(','));
    p.expectOp(')');
  }
  return args;
}
function sigName(p) {
  const t = p.next();
  if (!t || (t.t !== 'id' && t.t !== 'str')) p.fail(`expected a name after '$' or '@'`);
  return t.v;
}

function parseExpr(p) { return parseOr(p); }
function parseOr(p) { let l = parseAnd(p); while (p.isId('or')) { p.next(); l = { op: 'operator_or', args: { OPERAND1: l, OPERAND2: parseAnd(p) } }; } return l; }
function parseAnd(p) { let l = parseNot(p); while (p.isId('and')) { p.next(); l = { op: 'operator_and', args: { OPERAND1: l, OPERAND2: parseNot(p) } }; } return l; }
function parseNot(p) { if (p.isId('not')) { p.next(); return { op: 'operator_not', args: { OPERAND: parseNot(p) } }; } return parseCmp(p); }
function parseCmp(p) {
  const l = parseAdd(p), t = p.peek();
  if (t && t.t === 'op' && (t.v === '<' || t.v === '>' || t.v === '==')) {
    p.next(); const { op, l: ln, r: rn } = INFIX_BY_SYM[t.v];
    return { op, args: { [ln]: l, [rn]: parseAdd(p) } };
  }
  return l;
}
function parseBin(p, syms, sub) {
  let l = sub(p);
  for (;;) {
    const t = p.peek();
    if (!(t && t.t === 'op' && syms.includes(t.v))) return l;
    p.next(); const { op, l: ln, r: rn } = INFIX_BY_SYM[t.v];
    l = { op, args: { [ln]: l, [rn]: sub(p) } };
  }
}
function parseAdd(p) { return parseBin(p, ['+', '-'], parseMul); }
function parseMul(p) { return parseBin(p, ['*', '/', '%'], parsePrim); }
function parsePrim(p) {
  const t = p.next();
  if (!t) p.fail('unexpected end of line, expected a value');
  if (t.t === 'num' || t.t === 'str') return t.v;
  if (t.t === 'abs') return null;
  if (t.t === 'op') {
    if (t.v === '(') { const e = parseExpr(p); p.expectOp(')'); return e; }
    if (t.v === '%' && p.peek()?.t === 'str') return { arg: p.next().v };
    if (t.v === '-') p.fail('unary minus is not supported; write 0 - x');
    p.i--; p.fail(`unexpected ${p.desc()}, expected a value`);
  }
  if (t.t === 'sig') {
    const name = sigName(p);
    if (t.v === '$') return { var: name };
    if (p.eatOp('[')) { const idx = parseExpr(p); p.expectOp(']'); return { op: 'data_itemoflist', args: { LIST: name, INDEX: idx } }; }
    if (p.isOp('.') && p.isId('index', 1)) { p.i += 2; const [item] = parseCallArgs(p); return { op: 'data_itemnumoflist', args: { LIST: name, ITEM: item } }; }
    return { list: name };
  }
  if (t.t === 'id') {
    if (['and', 'or', 'not'].includes(t.v)) { p.i--; p.fail(`unexpected keyword '${t.v}' (parenthesize the operands)`); }
    if (p.isOp('(')) return makeNode(t.v, parseCallArgs(p), p, 'expr');
    return { arg: t.v };
  }
  p.fail('unexpected token');
}

// 1行を文として解析 → {node, colon}
function parseStmtTokens(p, ctx) {
  const t = p.peek();
  let node;
  if (t.t === 'sig') {
    p.next(); const name = sigName(p);
    if (t.v === '$') {
      if (p.eatOp('=')) node = { op: 'data_setvariableto', args: { VARIABLE: name, VALUE: parseExpr(p) } };
      else if (p.eatOp('+=')) node = { op: 'data_changevariableby', args: { VARIABLE: name, VALUE: parseExpr(p) } };
      else p.fail(`expected '=' or '+=' after $${name}`);
    } else if (p.eatOp('[')) {
      const idx = parseExpr(p); p.expectOp(']'); p.expectOp('=');
      node = { op: 'data_replaceitemoflist', args: { LIST: name, INDEX: idx, ITEM: parseExpr(p) } };
    } else {
      p.expectOp('.');
      const m = p.next();
      if (!m || m.t !== 'id') p.fail('expected a list method after "."');
      const args = parseCallArgs(p);
      const need = { append: 1, clear: 0, delete: 1, insert: 2 }[m.v];
      if (need === undefined) p.fail(`unknown list method "${m.v}" (append, clear, delete, insert)`);
      if (args.length !== need) p.fail(`@${name}.${m.v}() takes ${need} argument(s), got ${args.length}`);
      node = { append: () => ({ op: 'data_addtolist', args: { LIST: name, ITEM: args[0] } }), clear: () => ({ op: 'data_deletealloflist', args: { LIST: name } }),
        delete: () => ({ op: 'data_deleteoflist', args: { LIST: name, INDEX: args[0] } }), insert: () => ({ op: 'data_insertatlist', args: { LIST: name, INDEX: args[0], ITEM: args[1] } }) }[m.v]();
    }
  } else if (t.t === 'id' && t.v === 'call' && p.peek(1)?.t === 'str') {
    p.next(); const code = p.next().v;
    node = { call: code, args: parseCallArgs(p) };
  } else if (t.t === 'id') {
    p.next();
    if (!p.isOp('(')) p.fail(`expected '(' after "${t.v}"${hint(t.v)}`);
    node = makeNode(t.v, parseCallArgs(p), p, ctx);
  } else p.fail(`unexpected ${p.desc()} at start of statement`);
  const colon = p.eatOp(':');
  if (!p.done()) p.fail(`unexpected ${p.desc()} after statement`);
  return { node, colon };
}

function parseProcHeader(p) {
  p.next(); // 'proc'
  const code = p.next(); if (!code || code.t !== 'str') p.fail('expected a quoted custom block name, e.g. proc "move %s"(dx):');
  p.expectOp('(');
  const args = [];
  if (!p.eatOp(')')) {
    do { const a = p.next(); if (!a || (a.t !== 'id' && a.t !== 'str')) p.fail('expected a parameter name'); args.push(a.v); } while (p.eatOp(','));
    p.expectOp(')');
  }
  const codes = [...code.v.matchAll(/%[sb]/g)];
  if (codes.length !== args.length) p.fail(`"${code.v}" has ${codes.length} placeholder(s) (%s / %b) but ${args.length} parameter(s)`);
  const proc = { proc: code.v, args, warp: false };
  if (p.isId('warp')) { p.next(); proc.warp = true; }
  if (p.isId('defaults')) {
    p.next(); p.expectOp('='); p.expectOp('[');
    const d = [];
    if (!p.eatOp(']')) { do { const s = p.next(); if (!s || s.t !== 'str') p.fail('defaults must be strings'); d.push(s.v); } while (p.eatOp(',')); p.expectOp(']'); }
    proc.defaults = d;
  }
  p.expectOp(':');
  if (!p.done()) p.fail(`unexpected ${p.desc()} after proc header`);
  return proc;
}

/* ───────── 行・インデント処理 ───────── */
function toLines(text) {
  const out = [];
  text.split('\n').forEach((raw, idx) => {
    const s = raw.replace(/\r$/, '');
    if (!s.trim()) return;
    if (/^\s*#(?![:!])/.test(s)) return; // 通常コメントは無視（#: と #! は意味を持つ）
    if (/^\t/.test(s) || /^ *\t/.test(s)) throw new DslError('tabs are not allowed; indent with spaces', idx + 1);
    out.push({ no: idx + 1, indent: s.length - s.trimStart().length, text: s.trim() });
  });
  return out;
}
const commentOf = (line) => {
  const m = /^#:\s*(".*")$/.exec(line.text);
  if (!m) throw new DslError('comment must look like #: "text"', line.no);
  try { return { text: JSON.parse(m[1]) }; } catch { throw new DslError('invalid string in comment', line.no); }
};

function parseBody(L, pos, indent) {
  const nodes = []; let pending = null;
  while (pos.i < L.length && L[pos.i].indent === indent) {
    const line = L[pos.i];
    if (line.text.startsWith('#:')) { pending = commentOf(line); pos.i++; continue; }
    if (line.text.startsWith('#!')) throw new DslError('workspace comments (#!) are only allowed at top level', line.no);
    if (line.text === 'pass') { pos.i++; continue; }
    if (/^else\s*:/.test(line.text)) throw new DslError('"else" without a matching "if"', line.no);
    const p = new TP(lex(line.text, line.no), line.no);
    const { node, colon } = parseStmtTokens(p, 'stmt');
    pos.i++;
    const spec = node.op ? CATALOG[node.op] : null;
    if (spec?.sub && !colon) throw new DslError(`"${nameOf(node.op)}" needs a body: add ':' and an indented block`, line.no);
    if (!spec?.sub && colon) throw new DslError(`"${node.op ? nameOf(node.op) : 'call'}" does not take a body; remove ':'`, line.no);
    if (colon) {
      node.sub = childBody(L, pos, indent, line.no);
      if (!node.sub.length) delete node.sub;
      if (node.op === 'control_if' && pos.i < L.length && L[pos.i].indent === indent && L[pos.i].text === 'else:') {
        const eno = L[pos.i].no; pos.i++;
        node.op = 'control_if_else';
        node.sub2 = childBody(L, pos, indent, eno);
        if (!node.sub2.length) delete node.sub2;
      }
    }
    if (pending) { node.comment = pending; pending = null; }
    nodes.push(node);
  }
  if (pending) throw new DslError('comment (#:) is not followed by a statement', L[pos.i - 1]?.no);
  if (pos.i < L.length && L[pos.i].indent > indent) throw new DslError('unexpected indent', L[pos.i].no);
  return nodes;
}
function childBody(L, pos, indent, headNo) {
  if (pos.i >= L.length || L[pos.i].indent <= indent) throw new DslError('expected an indented block (use "pass" for an empty body)', headNo);
  return parseBody(L, pos, L[pos.i].indent);
}

/** DSLテキスト → ユニット配列 ({proc..} または [script...])。target用のワークスペースコメントも返す。 */
export function parseTarget(text) {
  const L = toLines(text), pos = { i: 0 };
  const res = { procs: [], scripts: [], comments: [] };
  let pending = null;
  while (pos.i < L.length) {
    const line = L[pos.i];
    if (line.indent !== 0) throw new DslError('unexpected indent at top level', line.no);
    if (line.text.startsWith('#:')) { pending = commentOf(line); pos.i++; continue; }
    if (line.text.startsWith('#!')) {
      const m = /^#!\s*(".*")$/.exec(line.text);
      if (!m) throw new DslError('workspace comment must look like #! "text"', line.no);
      res.comments.push({ text: JSON.parse(m[1]) }); pos.i++; continue;
    }
    const p = new TP(lex(line.text, line.no), line.no);
    pos.i++;
    const t0 = p.peek();
    if (t0.t === 'id' && t0.v === 'proc') {
      const proc = parseProcHeader(p);
      proc.body = childBody(L, pos, 0, line.no);
      if (pending) { proc.comment = pending; pending = null; }
      res.procs.push(proc);
    } else if (t0.t === 'id' && t0.v === 'stack' && p.isOp(':', 1) && p.t.length === 2) {
      const nodes = childBody(L, pos, 0, line.no);
      if (!nodes.length) throw new DslError('"stack:" needs at least one statement', line.no);
      res.scripts.push(nodes); pending = null;
    } else if (t0.t === 'id' && t0.v === 'loose') {
      p.next(); const e = parseExpr(p);
      if (!p.done()) p.fail(`unexpected ${p.desc()} after expression`);
      if (e === null || typeof e !== 'object' || !('op' in e)) p.fail('"loose" needs a reporter/boolean block expression');
      if (pending) { e.comment = pending; pending = null; }
      res.scripts.push([e]);
    } else {
      const { node, colon } = parseStmtTokens(p, 'hat');
      if (!node.op || CATALOG[node.op].k !== 'hat') p.fail('a top-level statement must start with a hat block, "proc", "stack:" or "loose"');
      if (!colon) p.fail(`script start "${nameOf(node.op)}" needs ':' and an indented body`);
      const rest = childBody(L, pos, 0, line.no);
      if (pending) { node.comment = pending; pending = null; }
      res.scripts.push([node, ...rest]);
    }
  }
  if (pending) throw new DslError('comment (#:) is not followed by a statement');
  return res;
}
/** 複数ユニットを配列で返す（手続き→スクリプトの順） */
export function parseUnits(text) { const t = parseTarget(text); return [...t.procs, ...t.scripts]; }

/** ユニットが参照する変数/リスト/カスタムブロックの集合 */
export function usedSymbols(unit) {
  const u = { vars: new Set(), lists: new Set(), procs: new Set() };
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n === null || typeof n !== 'object') return;
    if ('var' in n) u.vars.add(n.var);
    if ('list' in n) u.lists.add(n.list);
    if (n.call !== undefined) u.procs.add(n.call);
    if (n.args && !Array.isArray(n.args)) {
      const f = CATALOG[n.op]?.f ?? {};
      for (const [k, v] of Object.entries(n.args)) { if (f[k] === 'var') u.vars.add(v); else if (f[k] === 'list') u.lists.add(v); else walk(v); }
    } else if (Array.isArray(n.args)) n.args.forEach(walk);
    walk(n.sub); walk(n.sub2); walk(n.body);
  };
  walk(unit);
  return u;
}

/** 生成時に与える文脈ヘッダ。'#'コメントなのでDSLとしてそのまま読める。
 *  opts.used を渡すと「使う名前 + 決定的に選んだ最大k個のダミー」だけに絞る（巨大プロジェクトでもヘッダが肥大しない）。 */
export function contextHeader(t, globals = {}, opts = {}) {
  const { used, k = 12, seed = '' } = opts;
  const pick = (all, usedSet) => {
    if (!used) return { shown: all, omitted: 0 };
    const keep = all.filter((n) => usedSet.has(n));
    const rest = all.filter((n) => !usedSet.has(n)).map((n) => [md5(te.encode(seed + n)), n]).sort().slice(0, k).map((x) => x[1]);
    const shown = all.filter((n) => keep.includes(n) || rest.includes(n));
    return { shown, omitted: all.length - shown.length };
  };
  let omitted = 0;
  const names = (o, sig, usedSet) => { const r = pick(Object.keys(o ?? {}), usedSet ?? new Set()); omitted += r.omitted; return r.shown.map((n) => sig + nameTok(n)).join(' '); };
  const lines = [`# target: ${q(t.name)}`];
  const g = [names(globals.vars, '$', used?.vars), names(globals.lists, '@', used?.lists)].filter(Boolean).join(' ');
  const l = [names(t.vars, '$', used?.vars), names(t.lists, '@', used?.lists)].filter(Boolean).join(' ');
  if (g) lines.push(`# globals: ${g}`);
  if (l) lines.push(`# locals: ${l}`);
  const procs = pick((t.procs ?? []).map((p) => p.proc), used?.procs ?? new Set());
  omitted += procs.omitted;
  for (const p of t.procs ?? []) if (procs.shown.includes(p.proc)) lines.push(`# proc ${q(p.proc)}(${p.args.map(nameTok2).join(', ')})${p.warp ? ' warp' : ''}`);
  if (used && omitted) lines.push(`# (${omitted} more names omitted)`);
  return lines.join('\n');
}

/* ───────── プロジェクト形式（コードレベル: 宣言 + ステージ/スプライトのコード）─────────
   broadcasts "start", "end"
   global $score = 0
   global @log = [1, "a"]            # 65項目以上は data(件数) に省略（内容はモデルに書かせない）
   stage:
     when_flag():
       ...
   sprite "Player" x=0 y=-100 dir=90 size=100 hidden draggable rotation="left-right":
     local $speed = 5
     proc "go %s"(n):
       ...
   コスチューム/サウンド/モニターは含めない（ビルダーが既定のコスチュームを補う）。 */
const LIST_INLINE_MAX = 64;
const declLit = (v) => (typeof v === 'number' && Number.isFinite(v) && NUM_CANON.test(String(v)) && String(Number(String(v))) === String(v) ? String(v) : q(v));
const indentText = (t) => t.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
const decl = (kw, vars, lists) => [
  ...Object.entries(vars ?? {}).map(([k, v]) => `${kw} $${nameTok(k)} = ${declLit(v)}`),
  ...Object.entries(lists ?? {}).map(([k, v]) => `${kw} @${nameTok(k)} = ${v.length > LIST_INLINE_MAX ? `data(${v.length})` : `[${v.map(declLit).join(', ')}]`}`),
];

export function printProject(spec) {
  const out = [];
  if (spec.broadcasts?.length) out.push(`broadcasts ${spec.broadcasts.map(q).join(', ')}`);
  out.push(...decl('global', spec.globals, spec.globalLists));
  const body = (t, locals) => indentText([...locals, locals.length ? '' : null, printTarget(t).trimEnd()].filter((x) => x !== null && x !== '' || x === '').join('\n').replace(/^\n+/, ''));
  out.push('', 'stage:', body(spec.stage ?? {}, []));
  for (const s of spec.sprites ?? []) {
    const a = [];
    if (s.x) a.push(`x=${declLit(s.x)}`); if (s.y) a.push(`y=${declLit(s.y)}`);
    if (s.direction !== undefined && s.direction !== 90) a.push(`dir=${declLit(s.direction)}`);
    if (s.size !== undefined && s.size !== 100) a.push(`size=${declLit(s.size)}`);
    if (s.visible === false) a.push('hidden');
    if (s.draggable) a.push('draggable');
    if (s.rotationStyle && s.rotationStyle !== 'all around') a.push(`rotation=${q(s.rotationStyle)}`);
    out.push('', `sprite ${q(s.name)}${a.length ? ' ' + a.join(' ') : ''}:`, body(s, decl('local', s.vars, s.lists)));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function parseDecl(p) {
  const sg = p.next();
  if (!sg || sg.t !== 'sig') p.fail("expected $name or @name after 'global'/'local'");
  const name = sigName(p); p.expectOp('=');
  let value;
  if (sg.v === '$') {
    value = parseExpr(p);
    if (value !== null && typeof value === 'object') p.fail('a variable initial value must be a literal');
    if (value === null) value = '';
  } else if (p.eatOp('[')) {
    value = [];
    if (!p.eatOp(']')) { do { const v = parseExpr(p); if (v !== null && typeof v === 'object') p.fail('list items must be literals'); value.push(v ?? ''); } while (p.eatOp(',')); p.expectOp(']'); }
  } else if (p.isId('data') && p.isOp('(', 1)) {
    p.i += 2; const n = p.next();
    if (!n || n.t !== 'num') p.fail('data(N) needs a number');
    p.expectOp(')'); value = Array(n.v).fill('');
  } else p.fail('a list value must be [..] or data(N)');
  if (!p.done()) p.fail(`unexpected ${p.desc()} after declaration`);
  return { list: sg.v === '@', name, value };
}

export function parseProject(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const spec = { globals: {}, globalLists: {}, broadcasts: [], stage: { procs: [], scripts: [], comments: [] }, sprites: [] };
  let i = 0, sawStage = false;
  const collect = () => { const b = []; while (i < lines.length && (!lines[i].trim() || /^\s/.test(lines[i]))) { b.push({ no: i + 1, raw: lines[i] }); i++; } return b; };
  const target = (body, startNo) => {
    const locals = { vars: {}, lists: {} };
    const dedented = body.map(({ no, raw }) => {
      if (!raw.trim()) return '';
      if (!raw.startsWith('  ')) throw new DslError('section body must be indented by 2 spaces', no);
      const t = raw.slice(2);
      if (/^local\s/.test(t)) { const p = new TP(lex(t.trim(), no), no); p.next(); const d = parseDecl(p); (d.list ? locals.lists : locals.vars)[d.name] = d.value; return ''; }
      return t;
    });
    const t = parseTarget('\n'.repeat(Math.max(0, startNo - 1)) + dedented.join('\n'));
    return { ...t, ...{ vars: locals.vars, lists: locals.lists } };
  };
  while (i < lines.length) {
    const raw = lines[i], no = i + 1; i++;
    if (!raw.trim() || /^#(?![:!])/.test(raw)) continue;
    if (/^\s/.test(raw)) throw new DslError('unexpected indentation outside a stage/sprite section', no);
    const p = new TP(lex(raw.trim(), no), no), t0 = p.peek();
    if (t0.t === 'id' && t0.v === 'broadcasts') {
      p.next();
      do { const s = p.next(); if (!s || s.t !== 'str') p.fail('broadcasts must be quoted strings'); spec.broadcasts.push(s.v); } while (p.eatOp(','));
    } else if (t0.t === 'id' && t0.v === 'global') {
      p.next(); const d = parseDecl(p); (d.list ? spec.globalLists : spec.globals)[d.name] = d.value;
    } else if (t0.t === 'id' && t0.v === 'stage' && p.isOp(':', 1)) {
      if (sawStage) p.fail('duplicate "stage:" section');
      sawStage = true;
      const b = collect(); const t = target(b, b[0]?.no ?? no + 1);
      spec.stage = { procs: t.procs, scripts: t.scripts, comments: t.comments };
    } else if (t0.t === 'id' && t0.v === 'sprite') {
      p.next(); const nm = p.next();
      if (!nm || nm.t !== 'str') p.fail('expected a quoted sprite name, e.g. sprite "Cat" x=0 y=0:');
      const sp = { name: nm.v };
      while (!p.isOp(':') && !p.done()) {
        const k = p.next();
        if (!k || k.t !== 'id') p.fail(`unexpected ${p.desc()} in sprite header`);
        if (k.v === 'hidden') { sp.visible = false; continue; }
        if (k.v === 'draggable') { sp.draggable = true; continue; }
        p.expectOp('=');
        const v = p.next();
        if (!v || (v.t !== 'num' && v.t !== 'str')) p.fail(`expected a value after ${k.v}=`);
        const key = { x: 'x', y: 'y', dir: 'direction', size: 'size', rotation: 'rotationStyle' }[k.v];
        if (!key) p.fail(`unknown sprite attribute "${k.v}" (x, y, dir, size, hidden, draggable, rotation)`);
        sp[key] = v.v;
      }
      p.expectOp(':');
      const b = collect(); const t = target(b, b[0]?.no ?? no + 1);
      spec.sprites.push({ ...sp, ...t });
    } else p.fail(`unexpected ${p.desc()} at top level (expected broadcasts / global / stage: / sprite)`);
  }
  return spec;
}
