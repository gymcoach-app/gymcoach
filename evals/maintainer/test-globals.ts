import ts from 'typescript';

// The syntax-tree half of the `test-globals` tamper rule (runner.ts, issue
// #468 part b), and the `identifier-escape` rule. The test-globals regex
// catches a bare test global used as a call or a member (`afterEach(`,
// `expect.`) in the raw text; it cannot see one reached through the global
// object, where a hook pair registered from application code could install a
// cheat before a test and undo it before the canary's own afterEach check.
// This screen parses the file and reports:
//
// - every value use of a bare test global, by its cooked name, so a
//   unicode-escaped `afterEach(` is caught even though the regex is not;
// - a test global read off a global object, dotted or by a string key
//   (`globalThis.beforeEach`, `self['afterEach']`);
// - a global object indexed by a key that is not a literal
//   (`globalThis['after' + 'Each']`, `window[name]`);
// - a test global destructured from a global object, including a computed key
//   (`const { beforeEach } = globalThis`);
// - a global object handed anywhere it cannot be followed: a call argument
//   (`Reflect.get(globalThis, k)`), a spread, a return, an export, an object
//   or array element, a property or parameter default;
// - a test global taken as a value (`const h = afterEach`).
//
// Global objects: `globalThis`, `global`, `self`, `window`, and the names that
// reach the global object under jsdom (vitest copies them onto it): `top`,
// `parent`, `frames`, as roots and as chain members (`window.top`), and any
// `.defaultView` (`document.defaultView`, `el.ownerDocument.defaultView`).
// Aliases are followed by name, ignoring scope: `const g = globalThis`,
// `g = self`, casts, parentheses, `(0, globalThis)`, `a ?? globalThis`, a
// branch of a ternary, chains such as `globalThis.window`, and a renamed
// destructuring of a global member (`const { window: w } = globalThis`).
// Ignoring scope only adds hits (a local named `window` is treated as the
// global): fail closed, like the regexes. The exception is `top`, `parent` and
// `frames`, common local names: a reference to one is the global only when no
// enclosing scope declares a local of that name (the base's own app code uses
// all of them as locals). Type positions are skipped
// (`new globalThis.Set<string>()` reads `Set`, `typeof vi` in a type is erased).
//
// Parsing: `ts.createSourceFile` never throws. On a syntax error it recovers
// and returns a partial tree, so a file that does not parse is screened as far
// as the parser got (the regexes still read all of its text). `.tsx` and
// `.jsx` files parse as TSX, every other script as TS (JavaScript is a subset
// for this purpose).
//
// Limits: what the tree cannot name stays open. A global object obtained some
// other way (eval, the Function constructor, a constructor chain) is left to
// the module-system rule; one imported from a module outside the screened
// files is not followed.

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

// Roots that are also ordinary local names (`const top = rect.top`, a path's
// `parent`): a reference to one is the global object only when no enclosing
// scope declares it. The other roots stay scope-insensitive (fail closed).
const WEAK_ROOTS = new Set(['top', 'parent', 'frames']);

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

function hitOf(source: ts.SourceFile, kind: string, node: ts.Node): Hit {
  return {
    key: `${kind}: ${node.getText(source).replace(/\s+/g, ' ')}`,
    startLine: source.getLineAndCharacterOfPosition(node.getStart(source)).line,
    endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line,
  };
}

// The scope a declaration of a weak root binds in: the function (or file) for
// `var` and parameters, the nearest block-like node for everything else.
function isFunctionScope(node: ts.Node): boolean {
  return ts.isSourceFile(node) || ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node);
}

function isBlockScope(node: ts.Node): boolean {
  return (
    isFunctionScope(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  );
}

function scopeOf(decl: ts.Node, functionScoped: boolean): ts.Node {
  let node = decl.parent;
  while (!(functionScoped ? isFunctionScope(node) : isBlockScope(node))) node = node.parent;
  return node;
}

// For each weak root, the scopes that declare a local of that name.
function weakRootScopes(source: ts.SourceFile): Map<string, Set<ts.Node>> {
  const out = new Map<string, Set<ts.Node>>();
  const add = (name: ts.Node, scope: ts.Node) => {
    if (!ts.isIdentifier(name) || !WEAK_ROOTS.has(name.text)) return;
    const set = out.get(name.text) ?? new Set<ts.Node>();
    set.add(scope);
    out.set(name.text, set);
  };
  const bindNames = (name: ts.BindingName, scope: ts.Node) => {
    if (ts.isIdentifier(name)) add(name, scope);
    else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindNames(el.name, scope);
  };
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) {
      const list = node.parent;
      const isVar =
        ts.isVariableDeclarationList(list) &&
        (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
      bindNames(node.name, scopeOf(node, isVar));
    } else if (ts.isParameter(node)) {
      bindNames(node.name, node.parent);
    } else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      if (node.name) add(node.name, scopeOf(node, false));
    } else if (ts.isFunctionExpression(node) || ts.isClassExpression(node)) {
      if (node.name) add(node.name, node);
    } else if (ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      if (node.name) add(node.name, source);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      bindNames(node.variableDeclaration.name, node);
      ts.forEachChild(node.block, walk);
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return out;
}

function testGlobalHitsIn(source: ts.SourceFile): Hit[] {
  // Aliases found so far (names bound to a global object expression).
  const globals = new Set<string>();
  const weakScopes = weakRootScopes(source);
  const isRoot = (id: ts.Identifier): boolean => {
    if (!GLOBAL_OBJECTS.has(id.text)) return false;
    const scopes = weakScopes.get(id.text);
    if (!scopes) return true;
    for (let node: ts.Node | undefined = id.parent; node; node = node.parent)
      if (scopes.has(node)) return false;
    return true;
  };

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

  // The identifiers an expression's global-ness depends on (the leaves isGlobal
  // reads), so an alias is re-checked only when one of them becomes global.
  const leaves = (node: ts.Node, out: string[]): string[] => {
    if (isWrapper(node)) return leaves(node.expression, out);
    if (ts.isIdentifier(node)) out.push(node.text);
    else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      leaves(node.expression, out);
    else if (ts.isConditionalExpression(node)) {
      leaves(node.whenTrue, out);
      leaves(node.whenFalse, out);
    } else if (ts.isBinaryExpression(node) && VALUE_OPERATORS.has(node.operatorToken.kind)) {
      leaves(node.right, out);
      if (node.operatorToken.kind !== ts.SyntaxKind.CommaToken) leaves(node.left, out);
    }
    return out;
  };

  // Pass 1: alias edges in one walk. An edge says `name` is global when `expr`
  // is: a declaration or assignment of a plain name, and a destructuring of a
  // global member (`const { window: w } = globalThis` makes `w` global when
  // the initializer is).
  // A null expr marks a name bound to `.defaultView`, global from any object.
  const edges: { name: string; expr: ts.Expression | null }[] = [];
  const addPatternEdges = (pattern: ts.Node, expr: ts.Expression) => {
    if (ts.isObjectBindingPattern(pattern)) {
      for (const el of pattern.elements) {
        const key = keyName(el.propertyName ?? el.name);
        if (key === null || !isGlobalMember(key)) continue;
        const from = key === GLOBAL_MEMBER_ANYWHERE ? null : expr;
        if (ts.isIdentifier(el.name)) edges.push({ name: el.name.text, expr: from });
        else if (from) addPatternEdges(el.name, from);
      }
    } else if (ts.isObjectLiteralExpression(pattern)) {
      for (const prop of pattern.properties) {
        if (ts.isShorthandPropertyAssignment(prop)) {
          const name = prop.name.text;
          if (isGlobalMember(name))
            edges.push({ name, expr: name === GLOBAL_MEMBER_ANYWHERE ? null : expr });
        } else if (ts.isPropertyAssignment(prop)) {
          const key = keyName(prop.name);
          if (key === null || !isGlobalMember(key)) continue;
          const from = key === GLOBAL_MEMBER_ANYWHERE ? null : expr;
          if (ts.isIdentifier(prop.initializer))
            edges.push({ name: prop.initializer.text, expr: from });
          else if (from) addPatternEdges(prop.initializer, from);
        }
      }
    }
  };
  visit(source, (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) edges.push({ name: node.name.text, expr: node.initializer });
      else addPatternEdges(node.name, node.initializer);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      if (ts.isIdentifier(node.left)) edges.push({ name: node.left.text, expr: node.right });
      else addPatternEdges(node.left, node.right);
    }
  });

  // Close the alias set with a worklist: each edge is checked once up front and
  // again only when one of its leaves turns global.
  const dependents = new Map<string, number[]>();
  edges.forEach((edge, i) => {
    for (const leaf of new Set(edge.expr ? leaves(edge.expr, []) : [])) {
      const list = dependents.get(leaf) ?? [];
      list.push(i);
      dependents.set(leaf, list);
    }
  });
  const queue: string[] = [];
  const settle = (i: number) => {
    const { name, expr } = edges[i]!;
    if (!globals.has(name) && (expr === null || isGlobal(expr))) {
      globals.add(name);
      queue.push(name);
    }
  };
  edges.forEach((_, i) => settle(i));
  while (queue.length > 0) for (const i of dependents.get(queue.pop()!) ?? []) settle(i);

  const hits: Hit[] = [];
  const hit = (kind: string, node: ts.Node) => hits.push(hitOf(source, kind, node));

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
      if (key === null) hit('global object indexed by a computed key', parent);
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

// An identifier spelled with a unicode escape (`afterEach`, `\u{65}val`):
// no application file needs one, and the lexical rules read raw text, so an
// escaped `eval`, `Function` or test global would get past them.
function escapedIdentifierHitsIn(source: ts.SourceFile): Hit[] {
  const hits: Hit[] = [];
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
  return source ? testGlobalHitsIn(source) : [];
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
    const left = pool.get(h.key) ?? 0;
    if (!touched && left > 0) pool.set(h.key, left - 1);
    else out.push(h);
  }
  return out;
}
