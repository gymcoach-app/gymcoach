import ts from 'typescript';

// The syntax-tree half of the `test-globals` tamper rule (runner.ts, issue
// #468 part b), the `identifier-escape` rule and the cooked module specifiers
// the specifier rules also read. The test-globals regex catches a bare test
// global used as a call or a member (`afterEach(`, `expect.`) in the raw
// text; it cannot see one reached through the global object, where a hook
// pair registered from application code could install a cheat before a test
// and undo it before the canary's own afterEach check. The design is fail
// closed: what the screen cannot follow is reported, not excused. It reports:
//
// - every value use of a bare test global, by its cooked name, so an escaped
//   `\u0061fterEach(` is caught although the regex is not;
// - a test global read off a global object, dotted or by a string key
//   (`globalThis.beforeEach`, `self['afterEach']`);
// - a global object, `document` or any `.ownerDocument` indexed by a key that
//   is not a literal (`globalThis['after' + 'Each']`, `document[k]`);
// - a test hook name (`afterEach`, `beforeEach`, `beforeAll`, `afterAll`,
//   `onTestFinished`, `onTestFailed`, `vitest`) as a member, a literal key, a
//   destructuring key, an object key or a string, whatever the receiver
//   (`d[k].afterEach(fn)` on an object the screen cannot prove global);
// - any mention of `Reflect` or `getOwnPropertyDescriptor(s)` (an alias, a
//   destructuring, a computed read, a call);
// - a non-literal computed member that is then called or read again
//   (`x[k](...)`, `x[k].y`, `x[k][j]`, through parentheses, casts, `x!`, a
//   comma or `[x[k]][0]`), or a computed key destructured
//   (`const { [j]: h } = w`), on an added or changed line;
// - an assertion API name (`expect`, `vi`, `chai`, `assert`) read or
//   destructured off a tainted receiver: a non-literal computed read, the
//   global object, or a name bound to either (`const w = p[k]; w.expect(0)`);
// - a test global destructured from a global object, including a computed key
//   (`const { beforeEach } = globalThis`);
// - a global object handed anywhere it cannot be followed: a call argument
//   (`fn(globalThis)`), a spread, a return, an export, an object or array
//   element, a property or parameter default;
// - a test global taken as a value (`const h = afterEach`);
// - any declaration (variable, parameter, catch binding, function, class,
//   import binding, type-only or ambient, namespace member) of a bare test
//   global name or `defaultView`. A declaration of a global object name is
//   allowed: those names are roots by name, so a local of that name only adds
//   hits and hides nothing.
//
// Global objects: `globalThis`, `global`, `self`, `window`, `top`, `parent`,
// `frames`, by name and regardless of scope, as roots and as chain members
// (`window.top`), and any `.defaultView` (`document.defaultView`,
// `el.ownerDocument.defaultView`). `top` and `parent` reach the global object
// under jsdom (vitest copies the window's keys onto it); `frames` is not
// aliased by vitest and is listed only as a precaution. Aliases are followed
// by name: `const g = globalThis`, `g = self`, casts, parentheses,
// `(0, globalThis)`, `a ?? globalThis`, a branch of a ternary, chains such as
// `globalThis.window`, and a renamed destructuring of a global member
// (`const { window: w } = globalThis`). Type positions are skipped
// (`new globalThis.Set<string>()` reads `Set`, `typeof vi` in a type is
// erased), except for declarations, which are reported wherever they sit.
//
// Blame (newHits, newTestGlobalHits): a hit on an added or changed line is
// always blamed; a computed-key on a global object or `document` and any
// reflective hit whenever the file has a changed line; a computed member on
// an unknown receiver only on a changed line (the base uses the pattern); any
// other hit on unchanged lines only when the base does not already have its
// text. In a file whose base declares a global object name, or whose head adds
// one on a changed line, any changed line blames every hit of the file.
//
// Module specifiers: any backslash in a static or dynamic specifier string
// (import, export from, import type, import(), require) is an
// `identifier-escape` violation, and the specifier rules also run on each
// specifier's cooked text (`'vit\x65st'` reads as `'vitest'`).
//
// Parsing: `ts.createSourceFile` never throws. On a syntax error it recovers
// and returns a partial tree, so a file that does not parse is screened as far
// as the parser got (the regexes still read all of its text). `.tsx` and
// `.jsx` files parse as TSX, every other script as TS (JavaScript is a subset
// for this purpose).
//
// Limits: a screen, not a proof. A `constructor` read is reported on any
// receiver (any function's constructor is the Function constructor); a direct
// eval or Function call is left to the module-system rule. A global object
// obtained some other way, or imported from a module outside the screened
// files, is not followed. The main residual: a non-literal read of an object the screen
// does not track, stored in a variable and then used (called, read, or passed
// on): `const h = o[k]; h(fn)`, and any taint path the list below does not
// name. Only part (a)'s runtime probes and the mandatory diff review of a
// paid run's patch backstop it. The canary's identity record
// is compared only around tests, so it does not see an install-and-undo that
// runs inside a hidden test either: that is part (a)'s job.

// Taint (for the assertion API names): a value is tainted when it is a
// non-literal computed read, the global object, a member read, array or
// object literal containing a tainted value, an `await` of one, or a name
// bound to one. Bindings followed: declarations and parameter defaults
// (plain, object and array patterns, defaults, rest elements), assignments
// (`=`, `||=`, `??=`, `&&=`, object and array destructuring targets),
// for-of and for-in variables over a tainted iterable, every catch binding
// when the file has any taint source (what a try block throws is not
// followed), and a store of a tainted value into a member (`o.w = v` taints
// `o`; `this.w = v` and a class field initializer taint `this`). Not
// followed: a call argument into the callee's parameter, a return value into
// the caller (a call result is never tainted), a getter, a closure capture
// read through a call, a value round-tripped through a container method
// (`m.set(k, v); m.get(k)`), and anything not listed above.

// Names test code reads off the global object. The bare-name list is shorter:
// `it`, `test` or `assert` are ordinary identifiers in application code, but
// never as members of the global object.
const TEST_GLOBALS = new Set([
  'expect',
  'vi',
  'vitest',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'onTestFinished',
  'onTestFailed',
  'it',
  'test',
  'describe',
  'suite',
  'bench',
  'assert',
  'chai',
  'expectTypeOf',
  'assertType',
]);

// Bare names whose every value use is reported (the regex's list).
const BARE_TEST_GLOBALS = new Set([
  'expect',
  'vi',
  'vitest',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'onTestFinished',
  'onTestFailed',
]);

// Names that are the global object, as a root identifier or as a member of one.
const GLOBAL_OBJECTS = new Set([
  'globalThis',
  'global',
  'self',
  'window',
  'top',
  'parent',
  'frames',
]);

// A member that is the global object whatever it is read from.
const GLOBAL_MEMBER_ANYWHERE = 'defaultView';

const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/;

function scriptKind(file: string): ts.ScriptKind {
  return /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export interface Hit {
  key: string;
  // 0-based lines the reported node spans.
  startLine: number;
  endLine: number;
  // Blamed whenever the file has any added or changed line, wherever the hit
  // sits: a computed or reflective read can be redirected by a change to a
  // line far from it (the key's value), so its own lines prove nothing.
  always?: boolean;
  // Blamed only when it touches an added or changed line, never by text: an
  // ordinary pattern (`rows[i].weight`) the base already uses legitimately.
  lineOnly?: boolean;
}

// A node whose value is its operand's value (a cast, parentheses, `x!`).
function isWrapper(node: ts.Node): node is ts.Expression & { expression: ts.Expression } {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}

function literalKey(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  return null;
}

// The cooked name of a property key, or null when it is computed from a
// non-literal.
function keyName(key: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!key) return null;
  if (ts.isComputedPropertyName(key)) return literalKey(key.expression);
  if (ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key))
    return key.text;
  if (ts.isNoSubstitutionTemplateLiteral(key)) return key.text;
  return null;
}

// A member name that keeps the global object (`window.top`, `x.defaultView`).
const isGlobalMember = (name: string) =>
  GLOBAL_OBJECTS.has(name) || name === GLOBAL_MEMBER_ANYWHERE;

const VALUE_OPERATORS = new Set([
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.CommaToken,
]);

const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
]);

// Every node of the tree outside type positions (types are erased: nothing in
// them runs).
function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

function hitOf(
  source: ts.SourceFile,
  kind: string,
  node: ts.Node,
  blame: 'always' | 'lineOnly' | null = null,
): Hit {
  return {
    key: `${kind}: ${node.getText(source).replace(/\s+/g, ' ')}`,
    startLine: source.getLineAndCharacterOfPosition(node.getStart(source)).line,
    endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line,
    ...(blame ? { [blame]: true } : {}),
  };
}

// `document`, `x.document`, `x.ownerDocument` (dotted or by a literal key),
// or an alias of one (`const d = document`, `const { ownerDocument: d } = el`):
// objects whose `defaultView` is the global object.
const DOCUMENT_NAMES = new Set(['document', 'ownerDocument']);
function isDocument(node: ts.Node, aliases: ReadonlySet<string>): boolean {
  if (isWrapper(node)) return isDocument(node.expression, aliases);
  if (ts.isIdentifier(node)) return node.text === 'document' || aliases.has(node.text);
  if (ts.isPropertyAccessExpression(node)) return DOCUMENT_NAMES.has(node.name.text);
  if (ts.isElementAccessExpression(node)) {
    const key = literalKey(node.argumentExpression);
    return key !== null && DOCUMENT_NAMES.has(key);
  }
  return false;
}

// Test hook names flagged as a member, key or string whatever the receiver
// (`d[k].afterEach(fn)` on an object the screen cannot prove global).
const HOOK_NAMES = new Set([
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'onTestFinished',
  'onTestFailed',
  'vitest',
]);

// Assertion API names, flagged as a member, a literal key or a destructuring
// key when the receiver is tainted: a non-literal computed read, the global
// object, or a name bound to either (`const w = p[k]; w.expect(0)`). They are
// not hook names: `res.expect(200)` and `request(app).expect(200)` are
// ordinary APIs (a call result is never tainted). The canary's identity
// record is compared only around tests, so a function called inside a hidden
// test can patch a matcher and undo it before afterEach: that in-test
// install-and-undo is part (a)'s to catch, not the record's.
const ASSERTION_NAMES = new Set(['expect', 'vi', 'chai', 'assert']);

// Names that read a property the source does not spell: any mention is
// reported (`Reflect`, `const R = Reflect`, `Reflect['get']`,
// `Object.getOwnPropertyDescriptor`), since an alias of either is as good as
// the original. The base's app code uses none of them.
const REFLECTIVE_NAMES = new Set([
  'Reflect',
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
]);

// Names a declaration may not bind: a bare test global or `defaultView`.
// Global object names may be declared: they are roots by name, so a local of
// that name only adds hits (fail closed) and hides nothing.
const RESERVED_NAMES = new Set([...BARE_TEST_GLOBALS, GLOBAL_MEMBER_ANYWHERE]);

// The declared name of a binding-creating node, or null. Property-like names
// (object keys, class members, enum members) bind nothing in scope.
function declaredName(node: ts.Node): ts.Identifier | null {
  const p = node.parent;
  if (!ts.isIdentifier(node) || !p) return null;
  if (
    (ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isBindingElement(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isClassExpression(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isEnumDeclaration(p) ||
      ts.isModuleDeclaration(p) ||
      ts.isImportClause(p) ||
      ts.isImportSpecifier(p) ||
      ts.isNamespaceImport(p) ||
      ts.isImportEqualsDeclaration(p) ||
      ts.isTypeParameterDeclaration(p)) &&
    p.name === node
  )
    return node;
  return null;
}

function declarationHitsIn(source: ts.SourceFile): Hit[] {
  const hits: Hit[] = [];
  const walk = (node: ts.Node) => {
    const name = declaredName(node);
    if (name && RESERVED_NAMES.has(name.text))
      hits.push(hitOf(source, 'test global or defaultView name declared', node.parent));
    ts.forEachChild(node, walk);
  };
  walk(source);
  return hits;
}

// The 0-based lines of every declaration of a global object name.
function globalDeclarationLines(source: ts.SourceFile): number[] {
  const out: number[] = [];
  const walk = (node: ts.Node) => {
    const name = declaredName(node);
    if (name && GLOBAL_OBJECTS.has(name.text))
      out.push(source.getLineAndCharacterOfPosition(name.getStart(source)).line);
    ts.forEachChild(node, walk);
  };
  walk(source);
  return out;
}

function testGlobalHitsIn(source: ts.SourceFile): Hit[] {
  // Aliases found so far (names bound to a global object expression). The
  // roots are matched by name, whatever scope a reference sits in: a local of
  // the same name is itself a violation (declarationHitsIn), so shadowing
  // cannot be used to hide one.
  const globals = new Set<string>();
  const isRoot = (id: ts.Identifier): boolean => GLOBAL_OBJECTS.has(id.text);

  // Whether an expression is the global object, given the aliases so far.
  const isGlobal = (node: ts.Node): boolean => {
    if (isWrapper(node)) return isGlobal(node.expression);
    if (ts.isIdentifier(node)) return globals.has(node.text) || isRoot(node);
    if (ts.isPropertyAccessExpression(node))
      return (
        node.name.text === GLOBAL_MEMBER_ANYWHERE ||
        (GLOBAL_OBJECTS.has(node.name.text) && isGlobal(node.expression))
      );
    if (ts.isElementAccessExpression(node)) {
      const key = literalKey(node.argumentExpression);
      return (
        key === GLOBAL_MEMBER_ANYWHERE ||
        (key !== null && GLOBAL_OBJECTS.has(key) && isGlobal(node.expression))
      );
    }
    if (ts.isConditionalExpression(node)) return isGlobal(node.whenTrue) || isGlobal(node.whenFalse);
    if (ts.isBinaryExpression(node) && VALUE_OPERATORS.has(node.operatorToken.kind))
      return (
        isGlobal(node.right) ||
        (node.operatorToken.kind !== ts.SyntaxKind.CommaToken && isGlobal(node.left))
      );
    return false;
  };

  // The names an expression's value depends on (the leaves isGlobal, isDoc
  // and isTainted read; `this` for a class instance), so a binding is
  // re-checked only when one of them joins a set.
  const leaves = (node: ts.Node, out: string[]): string[] => {
    if (isWrapper(node)) return leaves(node.expression, out);
    if (ts.isIdentifier(node)) out.push(node.text);
    else if (node.kind === ts.SyntaxKind.ThisKeyword) out.push('this');
    else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      leaves(node.expression, out);
    else if (ts.isConditionalExpression(node)) {
      leaves(node.whenTrue, out);
      leaves(node.whenFalse, out);
    } else if (ts.isBinaryExpression(node) && VALUE_OPERATORS.has(node.operatorToken.kind)) {
      leaves(node.right, out);
      if (node.operatorToken.kind !== ts.SyntaxKind.CommaToken) leaves(node.left, out);
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) leaves(el, out);
    } else if (ts.isSpreadElement(node) || ts.isAwaitExpression(node)) {
      leaves(node.expression, out);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) leaves(prop.initializer, out);
        else if (ts.isShorthandPropertyAssignment(prop)) out.push(prop.name.text);
        else if (ts.isSpreadAssignment(prop)) leaves(prop.expression, out);
      }
    }
    return out;
  };

  // The names bound to a document (closed with the global aliases below).
  const docs = new Set<string>();
  const isDoc = (node: ts.Node) => isDocument(node, docs);
  // The names bound to a tainted value: a non-literal computed read, the
  // global object, or a value derived from either (see the edges below).
  const taint = new Set<string>();
  const isTainted = (node: ts.Node): boolean => {
    if (isWrapper(node)) return isTainted(node.expression);
    if (isGlobal(node)) return true;
    if (ts.isIdentifier(node)) return taint.has(node.text);
    if (node.kind === ts.SyntaxKind.ThisKeyword) return taint.has('this');
    if (ts.isElementAccessExpression(node))
      return literalKey(node.argumentExpression) === null || isTainted(node.expression);
    if (ts.isPropertyAccessExpression(node)) return isTainted(node.expression);
    if (ts.isArrayLiteralExpression(node)) return node.elements.some(isTainted);
    if (ts.isSpreadElement(node) || ts.isAwaitExpression(node)) return isTainted(node.expression);
    if (ts.isObjectLiteralExpression(node))
      return node.properties.some(
        (prop) =>
          (ts.isPropertyAssignment(prop) && isTainted(prop.initializer)) ||
          (ts.isShorthandPropertyAssignment(prop) && taint.has(prop.name.text)) ||
          (ts.isSpreadAssignment(prop) && isTainted(prop.expression)),
      );
    if (ts.isConditionalExpression(node)) return isTainted(node.whenTrue) || isTainted(node.whenFalse);
    if (ts.isBinaryExpression(node) && VALUE_OPERATORS.has(node.operatorToken.kind))
      return (
        isTainted(node.right) ||
        (node.operatorToken.kind !== ts.SyntaxKind.CommaToken && isTainted(node.left))
      );
    return false;
  };

  // Pass 1: binding edges in one walk. An edge binds `name` to the value
  // reached from `expr` through `path`, the keys from the outside in: empty
  // for a plain binding, a key name for an object destructuring, null for a
  // computed key that is not a literal, '#idx' for an array element or a
  // for-of/for-in variable, '#rest' for a rest element. A `taintOnly` edge
  // (a store into a member, a class field) feeds the taint set only.
  type Edge = { name: string; expr: ts.Expression; path: (string | null)[]; taintOnly?: boolean };
  const edges: Edge[] = [];
  // The identifier (or `this`) at the root of a member chain (`o.a[b].c`).
  const rootName = (node: ts.Expression): string | null => {
    let n: ts.Node = node;
    while (isWrapper(n) || ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n))
      n = n.expression;
    if (ts.isIdentifier(n)) return n.text;
    if (n.kind === ts.SyntaxKind.ThisKeyword) return 'this';
    return null;
  };
  const addTarget = (target: ts.Node, expr: ts.Expression, path: (string | null)[]) => {
    if (ts.isIdentifier(target)) edges.push({ name: target.text, expr, path });
    else if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      const root = rootName(target);
      if (root) edges.push({ name: root, expr, path, taintOnly: true });
    } else if (
      ts.isBinaryExpression(target) &&
      target.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      // `[w = fallback] = x`, `({ a: w = fallback } = x)`: either value.
      addTarget(target.left, expr, path);
      addTarget(target.left, target.right, []);
    } else addPatternEdges(target, expr, path);
  };
  const addPatternEdges = (pattern: ts.Node, expr: ts.Expression, path: (string | null)[]) => {
    if (ts.isObjectBindingPattern(pattern) || ts.isArrayBindingPattern(pattern)) {
      const array = ts.isArrayBindingPattern(pattern);
      for (const el of pattern.elements) {
        if (ts.isOmittedExpression(el)) continue;
        const key = el.dotDotDotToken
          ? '#rest'
          : array
            ? '#idx'
            : keyName(el.propertyName ?? el.name);
        if (ts.isIdentifier(el.name)) {
          edges.push({ name: el.name.text, expr, path: [...path, key] });
          if (el.initializer) edges.push({ name: el.name.text, expr: el.initializer, path: [] });
        } else addPatternEdges(el.name, expr, [...path, key]);
      }
    } else if (ts.isObjectLiteralExpression(pattern)) {
      for (const prop of pattern.properties) {
        if (ts.isShorthandPropertyAssignment(prop)) {
          edges.push({ name: prop.name.text, expr, path: [...path, prop.name.text] });
          if (prop.objectAssignmentInitializer)
            edges.push({ name: prop.name.text, expr: prop.objectAssignmentInitializer, path: [] });
        } else if (ts.isPropertyAssignment(prop)) {
          addTarget(prop.initializer, expr, [...path, keyName(prop.name)]);
        } else if (ts.isSpreadAssignment(prop)) {
          addTarget(prop.expression, expr, [...path, '#rest']);
        }
      }
    } else if (ts.isArrayLiteralExpression(pattern)) {
      for (const el of pattern.elements) {
        if (ts.isOmittedExpression(el)) continue;
        if (ts.isSpreadElement(el)) addTarget(el.expression, expr, [...path, '#rest']);
        else addTarget(el, expr, [...path, '#idx']);
      }
    }
  };
  const ASSIGNMENTS = new Set([
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ]);
  // Whether the file reads anything that can taint (a non-literal computed
  // read or a global object name): then every catch binding is tainted, since
  // what a try block throws is not followed.
  let taintSource = false;
  const catchNames: string[] = [];
  visit(source, (node) => {
    if (ts.isElementAccessExpression(node) && literalKey(node.argumentExpression) === null)
      taintSource = true;
    else if (ts.isIdentifier(node) && GLOBAL_OBJECTS.has(node.text)) taintSource = true;
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      const collect = (name: ts.BindingName) => {
        if (ts.isIdentifier(name)) catchNames.push(name.text);
        else
          for (const el of name.elements) if (!ts.isOmittedExpression(el)) collect(el.name);
      };
      collect(node.variableDeclaration.name);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name))
        edges.push({ name: node.name.text, expr: node.initializer, path: [] });
      else addPatternEdges(node.name, node.initializer, []);
    } else if (ts.isParameter(node) && node.initializer) {
      if (ts.isIdentifier(node.name))
        edges.push({ name: node.name.text, expr: node.initializer, path: [] });
      else addPatternEdges(node.name, node.initializer, []);
    } else if (ts.isBinaryExpression(node) && ASSIGNMENTS.has(node.operatorToken.kind)) {
      addTarget(node.left, node.right, []);
    } else if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const init = node.initializer;
      if (ts.isVariableDeclarationList(init)) {
        for (const decl of init.declarations) {
          if (ts.isIdentifier(decl.name))
            edges.push({ name: decl.name.text, expr: node.expression, path: ['#idx'] });
          else addPatternEdges(decl.name, node.expression, ['#idx']);
        }
      } else addTarget(init, node.expression, ['#idx']);
    } else if (ts.isPropertyDeclaration(node) && node.initializer) {
      edges.push({ name: 'this', expr: node.initializer, path: [], taintOnly: true });
    }
  });

  // What an edge binds, for each alias set. A destructured global member is
  // global when every key is a global member and either the initializer is
  // global or a key is `defaultView` (global from any object).
  const bindsGlobal = ({ expr, path, taintOnly }: Edge) => {
    if (taintOnly || path.some((k) => k === null || !isGlobalMember(k))) return false;
    return path.includes(GLOBAL_MEMBER_ANYWHERE) || isGlobal(expr);
  };
  const bindsDocument = ({ expr, path, taintOnly }: Edge) => {
    if (taintOnly) return false;
    const last = path[path.length - 1];
    return path.length === 0 ? isDoc(expr) : last !== null && last !== undefined && DOCUMENT_NAMES.has(last);
  };
  const bindsTaint = ({ expr, path }: Edge) => path.includes(null) || isTainted(expr);

  // Close an alias set with a worklist: each edge is checked once up front and
  // again only when one of its leaves joins the set.
  const dependents = new Map<string, number[]>();
  edges.forEach((edge, i) => {
    for (const leaf of new Set(leaves(edge.expr, []))) {
      const list = dependents.get(leaf) ?? [];
      list.push(i);
      dependents.set(leaf, list);
    }
  });
  const close = (set: Set<string>, binds: (edge: Edge) => boolean, seeds: string[] = []) => {
    const queue: string[] = [];
    for (const name of seeds)
      if (!set.has(name)) {
        set.add(name);
        queue.push(name);
      }
    const settle = (i: number) => {
      const edge = edges[i]!;
      if (!set.has(edge.name) && binds(edge)) {
        set.add(edge.name);
        queue.push(edge.name);
      }
    };
    edges.forEach((_, i) => settle(i));
    while (queue.length > 0) for (const i of dependents.get(queue.pop()!) ?? []) settle(i);
  };
  close(globals, bindsGlobal);
  close(docs, bindsDocument);
  close(taint, bindsTaint, taintSource ? catchNames : []);

  const hits: Hit[] = [];
  const hit = (kind: string, node: ts.Node, blame: 'always' | 'lineOnly' | null = null) =>
    hits.push(hitOf(source, kind, node, blame));

  // A destructuring of a global object: a test global, a computed key, a rest,
  // or a nested pattern under a key that is not a global member.
  const checkPattern = (pattern: ts.Node) => {
    if (ts.isObjectBindingPattern(pattern)) {
      for (const el of pattern.elements) {
        if (el.dotDotDotToken) {
          hit('rest of the global object', el);
          continue;
        }
        const key = keyName(el.propertyName ?? el.name);
        if (key === null || TEST_GLOBALS.has(key)) hit('test global destructured', el);
        else if (!ts.isIdentifier(el.name) && isGlobalMember(key)) checkPattern(el.name);
      }
    } else if (ts.isObjectLiteralExpression(pattern)) {
      for (const prop of pattern.properties) {
        if (ts.isSpreadAssignment(prop)) {
          hit('rest of the global object', prop);
          continue;
        }
        const key = keyName(prop.name);
        if (key === null || TEST_GLOBALS.has(key)) hit('test global destructured', prop);
        else if (
          ts.isPropertyAssignment(prop) &&
          !ts.isIdentifier(prop.initializer) &&
          isGlobalMember(key)
        )
          checkPattern(prop.initializer);
      }
    } else {
      hit('global object destructured', pattern);
    }
  };

  // Where a global object expression may appear without being reported.
  const checkGlobalUse = (node: ts.Expression) => {
    const parent = node.parent;
    // The enclosing expression is itself the global object: judge it instead.
    if (isWrapper(parent) || isGlobal(parent)) return;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      if (TEST_GLOBALS.has(parent.name.text)) hit('test global read off the global object', parent);
      return;
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === node) {
      const key = literalKey(parent.argumentExpression);
      if (key === null) hit('global object indexed by a computed key', parent, 'always');
      else if (TEST_GLOBALS.has(key)) hit('test global read off the global object', parent);
      return;
    }
    if (ts.isTypeOfExpression(parent) || ts.isPrefixUnaryExpression(parent)) return;
    if (ts.isBinaryExpression(parent) && COMPARISONS.has(parent.operatorToken.kind)) return;
    if (
      (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) &&
      parent.expression === node
    )
      return;
    if (ts.isConditionalExpression(parent) && parent.condition === node) return;
    if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
      if (!ts.isIdentifier(parent.name)) checkPattern(parent.name);
      // An exported alias reaches other modules, which this screen cannot follow.
      else if (ts.getCombinedModifierFlags(parent) & ts.ModifierFlags.Export)
        hit('global object exported', parent);
      return;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === node
    ) {
      if (ts.isIdentifier(parent.left)) return;
      if (ts.isObjectLiteralExpression(parent.left)) checkPattern(parent.left);
      else hit('global object stored', parent);
      return;
    }
    if (ts.isExpressionStatement(parent)) return;
    // The target of a destructuring assignment (`({ window: w } = globalThis)`)
    // is written, not read: the alias pass already bound it.
    if (
      ts.isPropertyAssignment(parent) &&
      parent.initializer === node &&
      ts.isObjectLiteralExpression(parent.parent) &&
      ts.isBinaryExpression(parent.parent.parent) &&
      parent.parent.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.parent.parent.left === parent.parent
    )
      return;
    hit('global object passed on', parent);
  };

  // An identifier in a value position, not a declared or member name.
  const isValueReference = (id: ts.Identifier): boolean => {
    const p = id.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    if (ts.isQualifiedName(p)) return false;
    if (
      (ts.isPropertyAssignment(p) ||
        ts.isMethodDeclaration(p) ||
        ts.isPropertyDeclaration(p) ||
        ts.isPropertySignature(p) ||
        ts.isMethodSignature(p) ||
        ts.isGetAccessor(p) ||
        ts.isSetAccessor(p) ||
        ts.isEnumMember(p)) &&
      p.name === id
    )
      return false;
    if (ts.isBindingElement(p) && (p.propertyName === id || p.name === id)) return false;
    if (
      (ts.isVariableDeclaration(p) ||
        ts.isParameter(p) ||
        ts.isFunctionDeclaration(p) ||
        ts.isFunctionExpression(p) ||
        ts.isClassDeclaration(p) ||
        ts.isClassExpression(p) ||
        ts.isInterfaceDeclaration(p) ||
        ts.isTypeAliasDeclaration(p) ||
        ts.isEnumDeclaration(p) ||
        ts.isModuleDeclaration(p)) &&
      p.name === id
    )
      return false;
    if (
      ts.isImportSpecifier(p) ||
      ts.isImportClause(p) ||
      ts.isNamespaceImport(p) ||
      ts.isExportSpecifier(p) ||
      ts.isLabeledStatement(p) ||
      ts.isBreakOrContinueStatement(p) ||
      ts.isJsxAttribute(p)
    )
      return false;
    return true;
  };

  visit(source, (node) => {
    if (ts.isExportSpecifier(node)) {
      const local = (node.propertyName ?? node.name).text;
      if (globals.has(local)) hit('global object exported', node);
      return;
    }
    // `{ defaultView: { afterEach } } = anything`: the nested pattern reads the
    // global object whatever the initializer is.
    if (ts.isBindingElement(node) && !ts.isIdentifier(node.name)) {
      if (keyName(node.propertyName) === GLOBAL_MEMBER_ANYWHERE) checkPattern(node.name);
      return;
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isObjectLiteralExpression(node.parent) &&
      keyName(node.name) === GLOBAL_MEMBER_ANYWHERE &&
      (ts.isObjectLiteralExpression(node.initializer) ||
        ts.isArrayLiteralExpression(node.initializer))
    ) {
      checkPattern(node.initializer);
      return;
    }
    // A test hook name anywhere but a bare value use (reported below): a
    // member, a key, a destructuring key, a string.
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && HOOK_NAMES.has(node.text)) {
      const p = node.parent;
      const bareUse = ts.isIdentifier(node) && isValueReference(node);
      if (!bareUse) hit('test global hook named on any receiver', p ?? node);
    }
    // `constructor` read as a member, key, destructuring key or string: any
    // function's constructor is the Function constructor, which builds code
    // that returns the global object without naming it (`(() => 0).constructor`,
    // review of #503). A class's own constructor declaration has no name node,
    // so it is not reported.
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === 'constructor')
      hit('constructor read (reaches the Function constructor)', node.parent ?? node);
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && REFLECTIVE_NAMES.has(node.text))
      hit('reflective property read (test global reachable)', node.parent ?? node, 'always');
    if (ts.isElementAccessExpression(node) && literalKey(node.argumentExpression) === null) {
      if (isDoc(node.expression))
        hit('document indexed by a computed key (test global reachable)', node, 'always');
      else if (!isGlobal(node.expression)) {
        // Climb through what keeps the value: parentheses, casts, `x!`, the
        // right of a comma, a literal index into an array literal
        // (`[w[j]][0]`).
        let value: ts.Node = node;
        for (;;) {
          const up: ts.Node = value.parent;
          if (isWrapper(up)) value = up;
          else if (
            ts.isBinaryExpression(up) &&
            up.operatorToken.kind === ts.SyntaxKind.CommaToken &&
            up.right === value
          )
            value = up;
          else if (
            ts.isArrayLiteralExpression(up) &&
            ts.isElementAccessExpression(up.parent) &&
            up.parent.expression === up &&
            literalKey(up.parent.argumentExpression) !== null
          )
            value = up.parent;
          else break;
        }
        const p = value.parent;
        if (
          (ts.isCallExpression(p) && p.expression === value) ||
          ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) &&
            p.expression === value)
        )
          hit('computed member used on an unknown receiver (test global reachable)', p, 'lineOnly');
      }
    }
    // `const { [j]: h } = w`: a computed read by destructuring.
    if (
      (ts.isBindingElement(node) &&
        node.propertyName &&
        ts.isComputedPropertyName(node.propertyName) &&
        literalKey(node.propertyName.expression) === null) ||
      (ts.isPropertyAssignment(node) &&
        ts.isComputedPropertyName(node.name) &&
        literalKey(node.name.expression) === null &&
        ts.isObjectLiteralExpression(node.parent) &&
        ts.isBinaryExpression(node.parent.parent) &&
        node.parent.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        node.parent.parent.left === node.parent)
    )
      hit('computed key destructured from an unknown object (test global reachable)', node, 'lineOnly');
    // An assertion API name read off a tainted receiver.
    if (
      ts.isPropertyAccessExpression(node) &&
      ASSERTION_NAMES.has(node.name.text) &&
      isTainted(node.expression)
    )
      hit('assertion API read off an untracked object', node);
    if (ts.isElementAccessExpression(node)) {
      const key = literalKey(node.argumentExpression);
      if (key !== null && ASSERTION_NAMES.has(key) && isTainted(node.expression))
        hit('assertion API read off an untracked object', node);
    }
    if (ts.isVariableDeclaration(node) && node.initializer && !ts.isIdentifier(node.name)) {
      if (isTainted(node.initializer))
        for (const el of ts.isObjectBindingPattern(node.name) ? node.name.elements : []) {
          const key = keyName(el.propertyName ?? el.name);
          if (key !== null && ASSERTION_NAMES.has(key))
            hit('assertion API destructured from an untracked object', el);
        }
    }
    if (!ts.isExpression(node)) return;
    if (ts.isIdentifier(node)) {
      // Names in non-value positions (a member name, a declaration) are
      // neither a global object nor a test global reference.
      if (!isValueReference(node)) return;
      // Every value use, by the cooked name: the regex reads raw text and
      // misses an escaped spelling.
      if (BARE_TEST_GLOBALS.has(node.text) && !isGlobal(node)) {
        hit('test global used from application code', node);
        return;
      }
    }
    if (isGlobal(node)) checkGlobalUse(node);
  });
  return hits;
}

// Every module specifier string of the file: static import and export from,
// import-equals require, import type (`import('x')` in a type), import() and
// require() calls with a literal argument.
function specifierLiterals(source: ts.SourceFile): ts.StringLiteralLike[] {
  const out: ts.StringLiteralLike[] = [];
  const take = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) out.push(node);
  };
  const walk = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) take(node.moduleSpecifier);
    else if (ts.isExternalModuleReference(node)) take(node.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      take(node.argument.literal);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      take(node.arguments[0]);
    ts.forEachChild(node, walk);
  };
  walk(source);
  return out;
}

// The file's module specifiers, cooked, each as an `import '<specifier>';`
// line, for the specifier rules (test-framework, module-system, host-io, ...)
// whose regexes read raw text: `'vit\x65st'` is matched as `'vitest'`.
export function specifierHits(
  file: string,
  content: string,
  matches: (line: string) => boolean,
): Hit[] {
  const source = parse(file, content);
  if (!source) return [];
  return specifierLiterals(source)
    .filter((lit) => matches(`import '${lit.text}';`))
    .map((lit) => hitOf(source, `module specifier ${JSON.stringify(lit.text)}`, lit));
}

// An identifier spelled with a unicode escape (`\u0061fterEach`, `\u{65}val`):
// no application file needs one, and the lexical rules read raw text, so an
// escaped `eval`, `Function` or test global would get past them.
function escapedIdentifierHitsIn(source: ts.SourceFile): Hit[] {
  const hits: Hit[] = [];
  // Any backslash in a module specifier: no import of this repo needs one.
  for (const lit of specifierLiterals(source))
    if (lit.getText(source).includes('\\')) hits.push(hitOf(source, 'escaped module specifier', lit));
  const walk = (node: ts.Node) => {
    if (
      (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) &&
      node.getText(source).includes('\\')
    )
      hits.push(hitOf(source, 'escaped identifier', node));
    ts.forEachChild(node, walk);
  };
  walk(source);
  return hits;
}

function parse(file: string, content: string): ts.SourceFile | null {
  if (!SCRIPT_FILE.test(file)) return null;
  return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind(file));
}

export function testGlobalHits(file: string, content: string): Hit[] {
  const source = parse(file, content);
  return source ? [...testGlobalHitsIn(source), ...declarationHitsIn(source)] : [];
}

export function escapedIdentifierHits(file: string, content: string): Hit[] {
  const source = parse(file, content);
  return source ? escapedIdentifierHitsIn(source) : [];
}

// The 0-based lines of `after` that are not in `before` (as a multiset, the
// same matching as runner.ts addedLines).
function addedLineNumbers(before: string, after: string): Set<number> {
  const pool = new Map<string, number>();
  for (const line of before.split('\n')) pool.set(line, (pool.get(line) ?? 0) + 1);
  const added = new Set<number>();
  after.split('\n').forEach((line, i) => {
    const left = pool.get(line) ?? 0;
    if (left > 0) pool.set(line, left - 1);
    else added.add(i);
  });
  return added;
}

// The hits of `after` the agent is blamed for: every hit that touches an added
// or changed line, and every hit whose text the base does not have as often
// (an unchanged line can become a hit when an alias is added elsewhere). A hit
// is excused only when it sits on unchanged lines and the base already had it.
export function newHits(
  screen: (file: string, content: string) => Hit[],
  file: string,
  before: string,
  after: string,
): Hit[] {
  const added = addedLineNumbers(before, after);
  const pool = new Map<string, number>();
  for (const h of screen(file, before)) pool.set(h.key, (pool.get(h.key) ?? 0) + 1);
  const out: Hit[] = [];
  for (const h of screen(file, after)) {
    let touched = false;
    for (let line = h.startLine; line <= h.endLine && !touched; line++) touched = added.has(line);
    if (h.always && added.size > 0) touched = true;
    if (h.lineOnly) {
      if (touched) out.push(h);
      continue;
    }
    const left = pool.get(h.key) ?? 0;
    if (!touched && left > 0) pool.set(h.key, left - 1);
    else out.push(h);
  }
  return out;
}

// The test-globals hits blamed on the agent. Defence in depth for the
// text-based excuse, fail closed: in a file whose base declares a global
// object name (a local `top`, `parent` or `window`; 6 such locals in 3 files
// of the base today), any changed line blames every hit of the file, since a
// change anywhere can move that local out of scope (deleted, moved, wrapped
// in a block) and turn an unchanged `{ top }` into the real global. A head
// that adds such a declaration on a changed line is treated the same way.
export function newTestGlobalHits(file: string, before: string, after: string): Hit[] {
  const b = parse(file, before);
  const a = parse(file, after);
  if (!a) return [];
  const added = addedLineNumbers(before, after);
  const removed = addedLineNumbers(after, before);
  const changed = added.size > 0 || removed.size > 0;
  const blameAll =
    (changed && b !== null && globalDeclarationLines(b).length > 0) ||
    globalDeclarationLines(a).some((line) => added.has(line));
  if (blameAll) return testGlobalHits(file, after);
  return newHits(testGlobalHits, file, before, after);
}
