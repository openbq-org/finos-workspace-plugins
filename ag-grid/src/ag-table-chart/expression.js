/*
 * OpenBQ's sparkline `customFormatter` is a JavaScript function in a string, such as
 *   "(params) => ({ fill: params.yValue >= 0 ? '#22c55e' : '#ef4444' })".
 * The frame's policy has no 'unsafe-eval', and a backend's string should not run as code, so
 * this parses the subset formatters use and evaluates it over the params object only:
 * literals, member access, ! - + * / %, comparisons, && || ??, ?: and Math functions.
 */

const MATH = { abs: Math.abs, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, sign: Math.sign };

function numbersOf(args) {
  return args.flat().map((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v)).filter((v) => typeof v === "number" && Number.isFinite(v));
}

/**
 * The functions of a formula, over a row: SUM, AVG, MIN, MAX and COUNT of their numeric arguments
 * (others are skipped), ABS, ROUND(x, places) and IF(test, then, else). Names ignore case.
 */
export const FUNCTIONS = {
  SUM: (...args) => numbersOf(args).reduce((a, b) => a + b, 0),
  AVG: (...args) => {
    const values = numbersOf(args);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  },
  MIN: (...args) => {
    const values = numbersOf(args);
    return values.length ? Math.min(...values) : null;
  },
  MAX: (...args) => {
    const values = numbersOf(args);
    return values.length ? Math.max(...values) : null;
  },
  COUNT: (...args) => numbersOf(args).length,
  ABS: (x) => (typeof x === "number" ? Math.abs(x) : null),
  ROUND: (x, places = 0) => {
    if (typeof x !== "number") return null;
    const factor = 10 ** Math.max(0, Math.min(12, Math.trunc(places)));
    return Math.round(x * factor) / factor;
  },
  IF: (test, then, otherwise = null) => (test ? then : otherwise),
};
const CALLABLE = new Set([...Object.values(MATH), ...Object.values(FUNCTIONS)]);
const BLOCKED = new Set(["__proto__", "prototype", "constructor"]);
const PUNCTUATION = ["===", "!==", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", "(", ")", "{", "}", "[", "]", ",", ".", ";"];
const MAX_SOURCE = 2000;

function tokenize(source, { columns = false } = {}) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (columns && ch === "[") {
      const end = source.indexOf("]", i + 1);
      if (end < 0) throw new SyntaxError("unterminated column reference");
      const name = source.slice(i + 1, end).trim();
      if (!name) throw new SyntaxError("empty column reference");
      tokens.push({ kind: "col", value: name });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      tokens.push({ kind: "num", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      let text = "";
      while (j < source.length && source[j] !== ch) {
        if (source[j] === "\\" && j + 1 < source.length) { text += source[j + 1]; j += 2; continue; }
        if (ch === "`" && source[j] === "$" && source[j + 1] === "{") throw new SyntaxError("template expressions are not supported");
        text += source[j++];
      }
      if (j >= source.length) throw new SyntaxError("unterminated string");
      tokens.push({ kind: "str", value: text });
      i = j + 1;
      continue;
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
    if (ident) {
      tokens.push({ kind: "id", value: ident[0] });
      i += ident[0].length;
      continue;
    }
    const punct = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (!punct) throw new SyntaxError(`unexpected character ${ch}`);
    tokens.push({ kind: "p", value: punct });
    i += punct.length;
  }
  return tokens;
}

function parser(tokens) {
  let pos = 0;
  const peek = (value) => tokens[pos] && tokens[pos].kind === "p" && tokens[pos].value === value;
  const take = (value) => { if (peek(value)) { pos++; return true; } return false; };
  const expect = (value) => { if (!take(value)) throw new SyntaxError(`expected ${value}`); };
  const identifier = () => {
    const token = tokens[pos];
    if (!token || token.kind !== "id") throw new SyntaxError("expected a name");
    pos++;
    return token.value;
  };

  function binary(next, operators) {
    return () => {
      let left = next();
      for (;;) {
        const op = operators.find((o) => peek(o));
        if (!op) return left;
        pos++;
        left = { type: "bin", op, left, right: next() };
      }
    };
  }

  function primary() {
    const token = tokens[pos];
    if (!token) throw new SyntaxError("unexpected end");
    if (token.kind === "num" || token.kind === "str") { pos++; return { type: "lit", value: token.value }; }
    if (token.kind === "col") { pos++; return { type: "col", name: token.value }; }
    if (token.kind === "id") {
      pos++;
      if (token.value === "true") return { type: "lit", value: true };
      if (token.value === "false") return { type: "lit", value: false };
      if (token.value === "null") return { type: "lit", value: null };
      if (token.value === "undefined") return { type: "lit", value: undefined };
      return { type: "name", name: token.value };
    }
    if (take("(")) { const inner = expression(); expect(")"); return inner; }
    if (take("{")) {
      const entries = [];
      while (!take("}")) {
        const key = tokens[pos];
        if (!key || (key.kind !== "id" && key.kind !== "str")) throw new SyntaxError("expected a key");
        pos++;
        const value = take(":") ? expression() : { type: "name", name: key.value };
        entries.push([String(key.value), value]);
        if (!take(",")) { expect("}"); break; }
      }
      return { type: "obj", entries };
    }
    throw new SyntaxError(`unexpected ${token.value}`);
  }

  function postfix() {
    let node = primary();
    for (;;) {
      if (take(".")) node = { type: "get", object: node, key: { type: "lit", value: identifier() } };
      else if (take("[")) { const key = expression(); expect("]"); node = { type: "get", object: node, key }; }
      else if (take("(")) {
        const args = [];
        while (!take(")")) {
          args.push(expression());
          if (!take(",")) { expect(")"); break; }
        }
        node = { type: "call", callee: node, args };
      } else return node;
    }
  }

  function unary() {
    if (take("!")) return { type: "not", arg: unary() };
    if (take("-")) return { type: "neg", arg: unary() };
    if (take("+")) return { type: "pos", arg: unary() };
    return postfix();
  }

  const multiplicative = binary(unary, ["*", "/", "%"]);
  const additive = binary(multiplicative, ["+", "-"]);
  const relational = binary(additive, ["<=", ">=", "<", ">"]);
  const equality = binary(relational, ["===", "!==", "==", "!="]);
  const and = binary(equality, ["&&"]);
  const or = binary(and, ["||", "??"]);

  function expression() {
    const test = or();
    if (!take("?")) return test;
    const consequent = expression();
    expect(":");
    return { type: "cond", test, consequent, alternate: expression() };
  }

  /* (params) => expr | params => expr | (params) => { return expr; } | function (params) { return expr; } */
  function program() {
    let param;
    if (tokens[pos]?.kind === "id" && tokens[pos].value === "function") {
      pos++;
      if (tokens[pos]?.kind === "id") pos++;
      expect("(");
      param = identifier();
      expect(")");
      return { param, body: block() };
    }
    if (take("(")) { param = identifier(); expect(")"); } else param = identifier();
    expect("=>");
    if (peek("{") && !looksLikeObject()) return { param, body: block() };
    return { param, body: expression() };
  }

  function looksLikeObject() {
    const next = tokens[pos + 1];
    return next && !(next.kind === "id" && next.value === "return");
  }

  function block() {
    expect("{");
    const name = identifier();
    if (name !== "return") throw new SyntaxError("expected return");
    const body = expression();
    take(";");
    expect("}");
    return body;
  }

  if (tokens.mode === "expression") {
    const body = expression();
    if (pos !== tokens.length) throw new SyntaxError("unexpected trailing input");
    return { param: null, body };
  }
  const result = program();
  take(";");
  if (pos !== tokens.length) throw new SyntaxError("unexpected trailing input");
  return result;
}

function evaluate(node, scope) {
  switch (node.type) {
    case "lit": return node.value;
    case "col": return scope.column ? scope.column(node.name) : undefined;
    case "name":
      if (node.name === scope.param) return scope.params;
      if (node.name === "Math") return MATH;
      if (scope.functions && Object.hasOwn(FUNCTIONS, node.name.toUpperCase())) return FUNCTIONS[node.name.toUpperCase()];
      return undefined;
    case "get": {
      const object = evaluate(node.object, scope);
      const key = String(evaluate(node.key, scope));
      if (object === null || object === undefined || BLOCKED.has(key)) return undefined;
      if (object === MATH) return Object.hasOwn(MATH, key) ? MATH[key] : undefined;
      if (typeof object === "string") return key === "length" ? object.length : undefined;
      return Object.hasOwn(object, key) ? object[key] : undefined;
    }
    case "call": {
      const fn = evaluate(node.callee, scope);
      if (!CALLABLE.has(fn)) throw new TypeError("only Math functions and SUM, AVG, MIN, MAX, COUNT, ABS, ROUND and IF can be called");
      return fn(...node.args.map((arg) => evaluate(arg, scope)));
    }
    case "obj": return Object.fromEntries(node.entries.map(([key, value]) => [key, evaluate(value, scope)]));
    case "not": return !evaluate(node.arg, scope);
    case "neg": return -evaluate(node.arg, scope);
    case "pos": return +evaluate(node.arg, scope);
    case "cond": return evaluate(node.test, scope) ? evaluate(node.consequent, scope) : evaluate(node.alternate, scope);
    case "bin": {
      if (node.op === "&&") return evaluate(node.left, scope) && evaluate(node.right, scope);
      if (node.op === "||") return evaluate(node.left, scope) || evaluate(node.right, scope);
      if (node.op === "??") return evaluate(node.left, scope) ?? evaluate(node.right, scope);
      const a = evaluate(node.left, scope);
      const b = evaluate(node.right, scope);
      switch (node.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "%": return a % b;
        case "<": return a < b;
        case ">": return a > b;
        case "<=": return a <= b;
        case ">=": return a >= b;
        case "===": return a === b;
        case "!==": return a !== b;
        // eslint-disable-next-line eqeqeq
        case "==": return a == b;
        // eslint-disable-next-line eqeqeq
        case "!=": return a != b;
      }
    }
  }
  throw new TypeError(`cannot evaluate ${node.type}`);
}

/** Compiles a formatter string to a function of one params object, or throws a SyntaxError. */
export function compileFormatter(source) {
  if (typeof source !== "string" || source.length > MAX_SOURCE) throw new SyntaxError("a formatter is a string of at most 2000 characters");
  const { param, body } = parser(tokenize(source));
  return (params) => {
    const result = evaluate(body, { param, params });
    return result && typeof result === "object" ? result : {};
  };
}

export function compileExpression(source) {
  if (typeof source !== "string" || source.length > MAX_SOURCE) throw new SyntaxError("an expression is a string of at most 2000 characters");
  const tokens = tokenize(source, { columns: true });
  tokens.mode = "expression";
  const { body } = parser(tokens);
  return (column) => evaluate(body, { param: null, params: undefined, column, functions: true });
}
