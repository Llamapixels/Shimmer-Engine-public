"""
Expression compiler for Shimmer Engine event scripts.

Turns a GB Studio-style math expression string, e.g.

    $score$ * 2 + rnd(6) >= max(best, 10) && !flag(met_king)

into the reverse-Polish ExprToken array that engine/source/script.c's
script_eval_expr() runs (see engine/include/script.h). Used by the
"if_expression", "set_var_expression" and "loop_while" events, and by
compiler/build_project.py itself to lower events such as
"if_actor_at_position" into one SCRIPT_IF_EXPR.

Syntax (C-like precedence, lowest first):
    ||   &&   |   ^   &   == !=   < <= > >=   << >>   + -   * / %
    unary - ! ~
Operands:
    123, 0x1F, true, false      integer literals (must fit in int16)
    $name$  or  name            a project variable
    (expr)
Functions:
    min(a, b)  max(a, b)  abs(a)  rnd(n) (0..n-1)  isqrt(a)
    actor_x(actor)  actor_y(actor)  actor_dir(actor)   pixels / 0-3
    held(button)  pressed(button)                        0/1
    flag(name)  item(name)                               0/1
    saved(slot)  peek(slot, variable)                    save slots 0-2
    scene()  time()
"actor", "button", "flag", "item" and peek's "variable" arguments are
names resolved at compile time, not expressions.

Keep EXPR_TOKENS in sync with the ExprToken enum in script.h.
"""

import re

EXPR_TOKENS = [
    "EXPR_END",
    "EXPR_CONST", "EXPR_VAR",
    "EXPR_ADD", "EXPR_SUB", "EXPR_MUL", "EXPR_DIV", "EXPR_MOD",
    "EXPR_EQ", "EXPR_NE", "EXPR_LT", "EXPR_LE", "EXPR_GT", "EXPR_GE",
    "EXPR_AND", "EXPR_OR", "EXPR_NOT",
    "EXPR_BAND", "EXPR_BOR", "EXPR_BXOR", "EXPR_BNOT", "EXPR_SHL", "EXPR_SHR",
    "EXPR_NEG", "EXPR_ABS", "EXPR_MIN", "EXPR_MAX", "EXPR_RND", "EXPR_ISQRT",
    "EXPR_ACTOR_X", "EXPR_ACTOR_Y", "EXPR_ACTOR_DIR",
    "EXPR_HELD", "EXPR_PRESSED",
    "EXPR_FLAG", "EXPR_ITEM",
    "EXPR_SAVED",
    "EXPR_PEEK",
    "EXPR_SCENE",
    "EXPR_TIME",
]

EXPR_STACK = 16          # script.c's EXPR_STACK
INT16_MIN, INT16_MAX = -32768, 32767


class ExprError(Exception):
    pass


# ---------------------------------------------------------------------------
# AST helpers. Nodes are tuples:
#   ("const", value)       value: int, or a C constant expression string
#   ("var", index)
#   ("op", token, [args])  token: an EXPR_* name
# build_project.py builds these directly for lowered events.
# ---------------------------------------------------------------------------

def const(v):
    return ("const", v)


def var(index):
    return ("var", index)


def op(token, *args):
    return ("op", token, list(args))


BINARY_FOLD = {
    "EXPR_ADD": lambda x, y: x + y,
    "EXPR_SUB": lambda x, y: x - y,
    "EXPR_MUL": lambda x, y: x * y,
    "EXPR_DIV": lambda x, y: int(x / y) if y else 0,     # C truncates
    "EXPR_MOD": lambda x, y: (x - int(x / y) * y) if y else 0,
    "EXPR_EQ": lambda x, y: int(x == y),
    "EXPR_NE": lambda x, y: int(x != y),
    "EXPR_LT": lambda x, y: int(x < y),
    "EXPR_LE": lambda x, y: int(x <= y),
    "EXPR_GT": lambda x, y: int(x > y),
    "EXPR_GE": lambda x, y: int(x >= y),
    "EXPR_AND": lambda x, y: int(bool(x) and bool(y)),
    "EXPR_OR": lambda x, y: int(bool(x) or bool(y)),
    "EXPR_BAND": lambda x, y: x & y,
    "EXPR_BOR": lambda x, y: x | y,
    "EXPR_BXOR": lambda x, y: x ^ y,
    "EXPR_SHL": lambda x, y: x << y if 0 <= y < 32 else 0,
    "EXPR_SHR": lambda x, y: x >> y if 0 <= y < 32 else 0,
    "EXPR_MIN": min,
    "EXPR_MAX": max,
}

UNARY_FOLD = {
    "EXPR_NOT": lambda x: int(not x),
    "EXPR_BNOT": lambda x: ~x,
    "EXPR_NEG": lambda x: -x,
    "EXPR_ABS": abs,
}


def _to_int32(v):
    v &= 0xFFFFFFFF
    return v - (1 << 32) if v & 0x80000000 else v


def fold(node):
    """Constant-fold integer-only subtrees (the engine evaluates on
    32-bit ints, so fold with the same wraparound)."""
    if node[0] != "op":
        return node
    token, args = node[1], [fold(a) for a in node[2]]
    if all(a[0] == "const" and isinstance(a[1], int) for a in args):
        vals = [a[1] for a in args]
        if token in BINARY_FOLD and len(vals) == 2:
            return const(_to_int32(BINARY_FOLD[token](*vals)))
        if token in UNARY_FOLD and len(vals) == 1:
            return const(_to_int32(UNARY_FOLD[token](*vals)))
    return ("op", token, args)


def to_rpn(node):
    """AST -> list of C tokens (strings/ints) ending in EXPR_END.
    Raises ExprError if the expression needs more than the engine's
    EXPR_STACK slots or a folded constant doesn't fit in int16."""
    node = fold(node)
    out = []

    def emit(n):
        """Returns the stack depth needed to evaluate n."""
        kind = n[0]
        if kind == "const":
            v = n[1]
            if isinstance(v, int) and not (INT16_MIN <= v <= INT16_MAX):
                raise ExprError(
                    f"constant {v} doesn't fit in a 16-bit signed integer "
                    f"({INT16_MIN}..{INT16_MAX}).")
            out.extend(["EXPR_CONST", v])
            return 1
        if kind == "var":
            out.extend(["EXPR_VAR", n[1]])
            return 1
        depth = 0
        for i, a in enumerate(n[2]):
            depth = max(depth, i + emit(a))
        out.append(n[1])
        return max(depth, 1)

    depth = emit(node)
    if depth > EXPR_STACK:
        raise ExprError(
            f"expression is too deeply nested (needs {depth} stack slots, "
            f"the engine has {EXPR_STACK}). Split it into several "
            "\"set_var_expression\" events.")
    out.append("EXPR_END")
    return out


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

TOKEN_RE = re.compile(r"""
    \s*(?:
        (?P<num>0[xX][0-9a-fA-F]+|\d+)
      | \$(?P<dvar>[^$]+)\$
      | (?P<name>[A-Za-z_][A-Za-z0-9_]*)
      | (?P<str>"[^"]*"|'[^']*')
      | (?P<op>\|\||&&|==|!=|<=|>=|<<|>>|[-+*/%<>!~&|^(),])
    )""", re.VERBOSE)

BINARY_LEVELS = [
    {"||": "EXPR_OR"},
    {"&&": "EXPR_AND"},
    {"|": "EXPR_BOR"},
    {"^": "EXPR_BXOR"},
    {"&": "EXPR_BAND"},
    {"==": "EXPR_EQ", "!=": "EXPR_NE"},
    {"<": "EXPR_LT", "<=": "EXPR_LE", ">": "EXPR_GT", ">=": "EXPR_GE"},
    {"<<": "EXPR_SHL", ">>": "EXPR_SHR"},
    {"+": "EXPR_ADD", "-": "EXPR_SUB"},
    {"*": "EXPR_MUL", "/": "EXPR_DIV", "%": "EXPR_MOD"},
]

UNARY = {"-": "EXPR_NEG", "!": "EXPR_NOT", "~": "EXPR_BNOT"}

# name -> (token, argument kinds). "expr" arguments are sub-expressions;
# the others are names resolved through the resolver at compile time.
FUNCTIONS = {
    "min": ("EXPR_MIN", ["expr", "expr"]),
    "max": ("EXPR_MAX", ["expr", "expr"]),
    "abs": ("EXPR_ABS", ["expr"]),
    "rnd": ("EXPR_RND", ["expr"]),
    "isqrt": ("EXPR_ISQRT", ["expr"]),
    "actor_x": ("EXPR_ACTOR_X", ["actor"]),
    "actor_y": ("EXPR_ACTOR_Y", ["actor"]),
    "actor_dir": ("EXPR_ACTOR_DIR", ["actor"]),
    "held": ("EXPR_HELD", ["button"]),
    "pressed": ("EXPR_PRESSED", ["button"]),
    "flag": ("EXPR_FLAG", ["flag"]),
    "item": ("EXPR_ITEM", ["item"]),
    "saved": ("EXPR_SAVED", ["expr"]),
    "peek": ("EXPR_PEEK", ["expr", "variable"]),
    "scene": ("EXPR_SCENE", []),
    "time": ("EXPR_TIME", []),
}


def tokenize(text):
    tokens = []
    pos = 0
    text = text.rstrip()
    while pos < len(text):
        m = TOKEN_RE.match(text, pos)
        if not m or m.end() == pos:
            raise ExprError(f"unexpected character {text[pos:].lstrip()[:1]!r} "
                            f"at position {pos + 1}.")
        pos = m.end()
        kind = m.lastgroup
        value = m.group(kind)
        if kind == "str":
            kind, value = "name", value[1:-1]
        tokens.append((kind, value))
    return tokens


class Parser:
    def __init__(self, text, resolver):
        self.tokens = tokenize(text)
        self.i = 0
        self.resolver = resolver

    def peek(self):
        return self.tokens[self.i] if self.i < len(self.tokens) else (None, None)

    def take(self):
        tok = self.peek()
        self.i += 1
        return tok

    def expect(self, value):
        kind, v = self.take()
        if v != value:
            raise ExprError(f"expected '{value}' but found "
                            f"{repr(v) if v is not None else 'the end'}.")

    def parse(self):
        if not self.tokens:
            raise ExprError("expression is empty.")
        node = self.binary(0)
        if self.i < len(self.tokens):
            raise ExprError(f"unexpected {self.peek()[1]!r} after the end of the expression.")
        return node

    def binary(self, level):
        if level == len(BINARY_LEVELS):
            return self.unary()
        node = self.binary(level + 1)
        ops = BINARY_LEVELS[level]
        while self.peek()[0] == "op" and self.peek()[1] in ops:
            token = ops[self.take()[1]]
            node = op(token, node, self.binary(level + 1))
        return node

    def unary(self):
        kind, v = self.peek()
        if kind == "op" and v in UNARY:
            self.take()
            return op(UNARY[v], self.unary())
        if kind == "op" and v == "+":
            self.take()
            return self.unary()
        return self.primary()

    def name_arg(self):
        kind, v = self.take()
        if kind in ("name", "num", "dvar"):
            return int(v, 0) if kind == "num" else v
        raise ExprError(f"expected a name but found {repr(v) if v else 'the end'}.")

    def primary(self):
        kind, v = self.take()
        if kind == "num":
            return const(int(v, 0))
        if kind == "dvar":
            return var(self.resolver.var(v))
        if kind == "name":
            low = v.lower()
            if self.peek()[1] == "(" and low in FUNCTIONS:
                return self.call(low)
            if low == "true":
                return const(1)
            if low == "false":
                return const(0)
            return var(self.resolver.var(v))
        if v == "(":
            node = self.binary(0)
            self.expect(")")
            return node
        raise ExprError(f"unexpected {repr(v) if v else 'end of expression'}.")

    def call(self, name):
        token, kinds = FUNCTIONS[name]
        self.expect("(")
        args = []
        for i, k in enumerate(kinds):
            if i:
                self.expect(",")
            if k == "expr":
                args.append(self.binary(0))
            elif k == "actor":
                args.append(const(self.resolver.actor(self.name_arg())))
            elif k == "button":
                args.append(const(self.resolver.button(self.name_arg())))
            elif k == "flag":
                args.append(const(self.resolver.flag(self.name_arg())))
            elif k == "item":
                args.append(const(self.resolver.item(self.name_arg())))
            elif k == "variable":
                args.append(const(self.resolver.var(self.name_arg())))
        self.expect(")")
        return op(token, *args)


def parse(text, resolver):
    """Parse an expression string to an AST. `resolver` provides
    var(name), actor(ref), button(name), flag(name), item(name), each
    returning an int or a C constant expression string (and raising on
    unknown names)."""
    if not isinstance(text, str):
        raise ExprError("expression must be a string.")
    return Parser(text, resolver).parse()


def compile_expression(text, resolver):
    return to_rpn(parse(text, resolver))
