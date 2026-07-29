/**
 * Extract entities (functions, classes, imports, calls) from AST.
 * Multi-language support via tree-sitter node type mapping.
 */
import type Parser from 'web-tree-sitter';
import { type Entity, type Edge, type ImportRecord, type Language, entityId } from '../graph/types.js';

export interface ExtractionResult {
  entities: Entity[];
  edges: Edge[];
  imports: ImportRecord[];
}

/** Extract entities and relationships from a parsed AST */
export function extractFromTree(
  tree: Parser.Tree,
  filePath: string,
  language: Language,
  source: string
): ExtractionResult {
  const entities: Entity[] = [];
  const edges: Edge[] = [];
  const imports: ImportRecord[] = [];

  const extractor = getExtractor(language);
  extractor(tree.rootNode, filePath, language, source, entities, edges, imports);

  return { entities, edges, imports };
}

type ExtractorFn = (
  root: Parser.SyntaxNode,
  filePath: string,
  language: Language,
  source: string,
  entities: Entity[],
  edges: Edge[],
  imports: ImportRecord[]
) => void;

function getExtractor(language: Language): ExtractorFn {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return extractTypeScript;
    case 'python':
      return extractPython;
    case 'go':
      return extractGo;
    case 'rust':
      return extractRust;
  }
}

// ─── TypeScript / JavaScript ───────────────────────────────────────

function extractTypeScript(
  root: Parser.SyntaxNode,
  filePath: string,
  language: Language,
  source: string,
  entities: Entity[],
  edges: Edge[],
  imports: ImportRecord[]
): void {
  walkNode(root, (node, parent) => {
    // Functions
    if (
      node.type === 'function_declaration' ||
      node.type === 'arrow_function' ||
      node.type === 'function'
    ) {
      const nameNode =
        node.childForFieldName('name') ??
        (parent?.type === 'variable_declarator'
          ? parent.childForFieldName('name')
          : null);
      if (nameNode) {
        const name = nameNode.text;
        entities.push({
          id: entityId(filePath, name, 'function'),
          name,
          kind: 'function',
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: getSignature(node, source),
          docComment: getLeadingComment(node, source),
        });
      }
    }

    // Classes
    if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = nameNode.text;
        entities.push({
          id: entityId(filePath, name, 'class'),
          name,
          kind: 'class',
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: `class ${name}`,
          docComment: getLeadingComment(node, source),
        });

        // Extract extends/implements
        const heritage = node.childForFieldName('heritage');
        if (heritage) {
          edges.push({
            sourceId: entityId(filePath, name, 'class'),
            targetId: `__unresolved::class::${heritage.text}`,
            kind: 'extends',
            filePath,
            line: heritage.startPosition.row + 1,
          });
        }
      }
    }

    // Methods
    if (node.type === 'method_definition' || node.type === 'public_field_definition') {
      const nameNode = node.childForFieldName('name');
      const classNode = findParentOfType(node, 'class_declaration');
      if (nameNode && classNode) {
        const className = classNode.childForFieldName('name')?.text ?? 'Anonymous';
        const methodName = nameNode.text;
        entities.push({
          id: entityId(filePath, `${className}.${methodName}`, 'method'),
          name: `${className}.${methodName}`,
          kind: 'method',
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: getSignature(node, source),
          module: className,
        });
      }
    }

    // Interfaces
    if (node.type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        entities.push({
          id: entityId(filePath, nameNode.text, 'interface'),
          name: nameNode.text,
          kind: 'interface',
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: `interface ${nameNode.text}`,
          docComment: getLeadingComment(node, source),
        });
      }
    }

    // Import statements → edges + import records
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const importPath = sourceNode.text.replace(/['"]/g, '');
        edges.push({
          sourceId: `${filePath}::module::__file__`,
          targetId: `__unresolved::module::${importPath}`,
          kind: 'imports',
          filePath,
          line: node.startPosition.row + 1,
        });

        // Extract import bindings (aliases) for the imports table.
        // Handles all TS/JS import forms:
        //   import D from './m'                          → default, alias='D'
        //   import { A, B as C } from './m'              → named, aliases 'A','C'
        //   import * as N from './m'                     → namespace, alias='N'
        //   import D, { A, B as C } from './m'           → default + named
        //   import './m'                                 → side_effect, no alias
        const line = node.startPosition.row + 1;
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;

          if (child.type === 'import_clause') {
            // Recurse into import_clause to find default/namespace/named
            for (let j = 0; j < child.childCount; j++) {
              const clauseChild = child.child(j);
              if (!clauseChild) continue;

              if (clauseChild.type === 'identifier') {
                // Default import: import D from './m'
                imports.push({
                  sourceFile: filePath,
                  targetFile: '',
                  targetModule: importPath,
                  importedName: 'default',
                  localAlias: clauseChild.text,
                  importKind: 'default',
                  line,
                });
              } else if (clauseChild.type === 'namespace_import') {
                // import * as N from './m'
                const aliasNode = clauseChild.childForFieldName('name');
                if (aliasNode) {
                  imports.push({
                    sourceFile: filePath,
                    targetFile: '',
                    targetModule: importPath,
                    importedName: null,
                    localAlias: aliasNode.text,
                    importKind: 'namespace',
                    line,
                  });
                }
              } else if (clauseChild.type === 'named_imports') {
                // import { A, B as C } from './m'
                for (let k = 0; k < clauseChild.childCount; k++) {
                  const spec = clauseChild.child(k);
                  if (!spec) continue;
                  if (spec.type === 'import_specifier') {
                    const nameNode = spec.childForFieldName('name');
                    const aliasNode = spec.childForFieldName('alias');
                    const importedName = nameNode?.text ?? '';
                    const localAlias = aliasNode?.text ?? importedName;
                    if (importedName) {
                      imports.push({
                        sourceFile: filePath,
                        targetFile: '',
                        targetModule: importPath,
                        importedName,
                        localAlias,
                        importKind: 'named',
                        line,
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // Side-effect only import (no import_clause): import './m'
        const hasClause = Array.from({ length: node.childCount }, (_, i) => node.child(i)?.type)
          .some((t) => t === 'import_clause');
        if (!hasClause) {
          imports.push({
            sourceFile: filePath,
            targetFile: '',
            targetModule: importPath,
            importedName: null,
            localAlias: '',  // no local binding
            importKind: 'side_effect',
            line,
          });
        }
      }
    }

    // Variable assignments tracking: const x = new Y() / const x = importedY
    // Records that `x` is an instance of `Y`, allowing `x.foo()` to resolve
    // to Y's methods. Stored as a special import record with importKind='named'
    // and targetFile = file where Y is defined (resolved later).
    if (
      (node.type === 'lexical_declaration' || node.type === 'variable_declaration') &&
      parent?.type !== 'export_statement'
    ) {
      trackVariableAssignment(node, filePath, imports);
    }

    // Call expressions → edges
    if (node.type === 'call_expression') {
      const funcNode = node.childForFieldName('function');
      if (funcNode) {
        const callerEntity = findEnclosingFunction(node, filePath);
        if (callerEntity) {
          edges.push({
            sourceId: callerEntity,
            targetId: `__unresolved::function::${funcNode.text}`,
            kind: 'calls',
            filePath,
            line: node.startPosition.row + 1,
          });
        }
      }
    }
  });
}

// ─── Python ────────────────────────────────────────────────────────

function extractPython(
  root: Parser.SyntaxNode,
  filePath: string,
  language: Language,
  source: string,
  entities: Entity[],
  edges: Edge[],
  imports: ImportRecord[]
): void {
  walkNode(root, (node) => {
    if (node.type === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const parentClass = findParentOfType(node, 'class_definition');
        const kind = parentClass ? 'method' : 'function';
        const className = parentClass?.childForFieldName('name')?.text;
        const fullName = className ? `${className}.${nameNode.text}` : nameNode.text;

        entities.push({
          id: entityId(filePath, fullName, kind),
          name: fullName,
          kind,
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: getFirstLine(node, source),
          docComment: getPythonDocstring(node),
          module: className,
        });
      }
    }

    if (node.type === 'class_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        entities.push({
          id: entityId(filePath, nameNode.text, 'class'),
          name: nameNode.text,
          kind: 'class',
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: getFirstLine(node, source),
          docComment: getPythonDocstring(node),
        });
      }
    }

    if (node.type === 'import_statement' || node.type === 'import_from_statement') {
      const moduleName = node.childForFieldName('module_name')?.text ?? node.text;
      edges.push({
        sourceId: `${filePath}::module::__file__`,
        targetId: `__unresolved::module::${moduleName}`,
        kind: 'imports',
        filePath,
        line: node.startPosition.row + 1,
      });
    }

    if (node.type === 'call') {
      const funcNode = node.childForFieldName('function');
      if (funcNode) {
        const callerEntity = findEnclosingPythonFunction(node, filePath);
        if (callerEntity) {
          edges.push({
            sourceId: callerEntity,
            targetId: `__unresolved::function::${funcNode.text}`,
            kind: 'calls',
            filePath,
            line: node.startPosition.row + 1,
          });
        }
      }
    }
  });
}

// ─── Go ────────────────────────────────────────────────────────────

function extractGo(
  root: Parser.SyntaxNode,
  filePath: string,
  language: Language,
  source: string,
  entities: Entity[],
  edges: Edge[],
  imports: ImportRecord[]
): void {
  walkNode(root, (node) => {
    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        entities.push({
          id: entityId(filePath, nameNode.text, 'function'),
          name: nameNode.text,
          kind: 'function',
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: getFirstLine(node, source),
          docComment: getLeadingComment(node, source),
        });
      }
    }

    if (node.type === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      const receiver = node.childForFieldName('receiver');
      if (nameNode) {
        const receiverType = receiver?.text?.replace(/[*()\s]/g, '') ?? 'Unknown';
        const fullName = `${receiverType}.${nameNode.text}`;
        entities.push({
          id: entityId(filePath, fullName, 'method'),
          name: fullName,
          kind: 'method',
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: getFirstLine(node, source),
          module: receiverType,
        });
      }
    }

    if (node.type === 'type_declaration') {
      const spec = node.namedChildren.find((c) => c.type === 'type_spec');
      if (spec) {
        const nameNode = spec.childForFieldName('name');
        const typeNode = spec.childForFieldName('type');
        if (nameNode) {
          const kind = typeNode?.type === 'interface_type' ? 'interface' : 'class';
          entities.push({
            id: entityId(filePath, nameNode.text, kind),
            name: nameNode.text,
            kind,
            filePath,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            language,
            signature: getFirstLine(node, source),
          });
        }
      }
    }

    if (node.type === 'import_declaration') {
      for (const spec of node.namedChildren) {
        if (spec.type === 'import_spec' || spec.type === 'import_spec_list') {
          const pathNode = spec.type === 'import_spec'
            ? spec.childForFieldName('path')
            : null;
          const importPath = pathNode?.text?.replace(/"/g, '') ?? spec.text;
          edges.push({
            sourceId: `${filePath}::module::__file__`,
            targetId: `__unresolved::module::${importPath}`,
            kind: 'imports',
            filePath,
            line: spec.startPosition.row + 1,
          });
        }
      }
    }

    if (node.type === 'call_expression') {
      const funcNode = node.childForFieldName('function');
      if (funcNode) {
        const caller = findEnclosingGoFunction(node, filePath);
        if (caller) {
          edges.push({
            sourceId: caller,
            targetId: `__unresolved::function::${funcNode.text}`,
            kind: 'calls',
            filePath,
            line: node.startPosition.row + 1,
          });
        }
      }
    }
  });
}

// ─── Rust ──────────────────────────────────────────────────────────

function extractRust(
  root: Parser.SyntaxNode,
  filePath: string,
  language: Language,
  source: string,
  entities: Entity[],
  edges: Edge[],
  imports: ImportRecord[]
): void {
  walkNode(root, (node) => {
    if (node.type === 'function_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const implBlock = findParentOfType(node, 'impl_item');
        const implName = implBlock?.childForFieldName('type')?.text;
        const kind = implBlock ? 'method' : 'function';
        const fullName = implName ? `${implName}::${nameNode.text}` : nameNode.text;

        entities.push({
          id: entityId(filePath, fullName, kind),
          name: fullName,
          kind,
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: getFirstLine(node, source),
          docComment: getLeadingComment(node, source),
          module: implName,
        });
      }
    }

    if (node.type === 'struct_item' || node.type === 'enum_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        entities.push({
          id: entityId(filePath, nameNode.text, 'class'),
          name: nameNode.text,
          kind: 'class',
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: getFirstLine(node, source),
          docComment: getLeadingComment(node, source),
        });
      }
    }

    if (node.type === 'trait_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        entities.push({
          id: entityId(filePath, nameNode.text, 'interface'),
          name: nameNode.text,
          kind: 'interface',
          filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          language,
          signature: getFirstLine(node, source),
        });
      }
    }

    if (node.type === 'use_declaration') {
      const path = node.childForFieldName('argument')?.text ?? node.text;
      edges.push({
        sourceId: `${filePath}::module::__file__`,
        targetId: `__unresolved::module::${path}`,
        kind: 'imports',
        filePath,
        line: node.startPosition.row + 1,
      });
    }

    if (node.type === 'call_expression') {
      const funcNode = node.childForFieldName('function');
      if (funcNode) {
        const caller = findEnclosingRustFunction(node, filePath);
        if (caller) {
          edges.push({
            sourceId: caller,
            targetId: `__unresolved::function::${funcNode.text}`,
            kind: 'calls',
            filePath,
            line: node.startPosition.row + 1,
          });
        }
      }
    }
  });
}

// ─── Helpers ───────────────────────────────────────────────────────

function walkNode(
  node: Parser.SyntaxNode,
  callback: (node: Parser.SyntaxNode, parent: Parser.SyntaxNode | null) => void
): void {
  const cursor = node.walk();
  let reachedRoot = false;

  while (!reachedRoot) {
    callback(cursor.currentNode, cursor.currentNode.parent);

    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;

    let retracing = true;
    while (retracing) {
      if (!cursor.gotoParent()) {
        retracing = false;
        reachedRoot = true;
      } else if (cursor.gotoNextSibling()) {
        retracing = false;
      }
    }
  }
}

function findParentOfType(
  node: Parser.SyntaxNode,
  type: string
): Parser.SyntaxNode | null {
  let current = node.parent;
  while (current) {
    if (current.type === type) return current;
    current = current.parent;
  }
  return null;
}

function findEnclosingFunction(node: Parser.SyntaxNode, filePath: string): string | null {
  const fn = findParentOfType(node, 'function_declaration') ??
    findParentOfType(node, 'arrow_function') ??
    findParentOfType(node, 'method_definition');
  if (!fn) return `${filePath}::module::__file__`;
  const nameNode = fn.childForFieldName('name');
  if (!nameNode) return null;
  return entityId(filePath, nameNode.text, fn.type === 'method_definition' ? 'method' : 'function');
}

function findEnclosingPythonFunction(node: Parser.SyntaxNode, filePath: string): string | null {
  const fn = findParentOfType(node, 'function_definition');
  if (!fn) return `${filePath}::module::__file__`;
  const nameNode = fn.childForFieldName('name');
  if (!nameNode) return null;
  const parentClass = findParentOfType(fn, 'class_definition');
  const className = parentClass?.childForFieldName('name')?.text;
  const fullName = className ? `${className}.${nameNode.text}` : nameNode.text;
  return entityId(filePath, fullName, parentClass ? 'method' : 'function');
}

function findEnclosingGoFunction(node: Parser.SyntaxNode, filePath: string): string | null {
  const fn = findParentOfType(node, 'function_declaration') ??
    findParentOfType(node, 'method_declaration');
  if (!fn) return `${filePath}::module::__file__`;
  const nameNode = fn.childForFieldName('name');
  if (!nameNode) return null;
  if (fn.type === 'method_declaration') {
    const receiver = fn.childForFieldName('receiver')?.text?.replace(/[*()\s]/g, '') ?? '';
    return entityId(filePath, `${receiver}.${nameNode.text}`, 'method');
  }
  return entityId(filePath, nameNode.text, 'function');
}

function findEnclosingRustFunction(node: Parser.SyntaxNode, filePath: string): string | null {
  const fn = findParentOfType(node, 'function_item');
  if (!fn) return `${filePath}::module::__file__`;
  const nameNode = fn.childForFieldName('name');
  if (!nameNode) return null;
  const implBlock = findParentOfType(fn, 'impl_item');
  const implName = implBlock?.childForFieldName('type')?.text;
  const fullName = implName ? `${implName}::${nameNode.text}` : nameNode.text;
  return entityId(filePath, fullName, implBlock ? 'method' : 'function');
}

function getSignature(node: Parser.SyntaxNode, source: string): string {
  const lines = source.slice(node.startIndex, node.endIndex).split('\n');
  // Return first line (usually the signature)
  return lines[0]?.trim() ?? '';
}

function getFirstLine(node: Parser.SyntaxNode, source: string): string {
  const text = source.slice(node.startIndex, node.endIndex);
  const firstLine = text.split('\n')[0] ?? '';
  return firstLine.trim();
}

function getLeadingComment(node: Parser.SyntaxNode, source: string): string | undefined {
  // Collect all consecutive comment nodes immediately before this node
  const comments: string[] = [];
  let prev = node.previousNamedSibling;
  while (prev && (prev.type === 'comment' || prev.type === 'line_comment' || prev.type === 'block_comment')) {
    comments.unshift(prev.text);
    prev = prev.previousNamedSibling;
  }
  return comments.length > 0 ? comments.join('\n') : undefined;
}

function getPythonDocstring(node: Parser.SyntaxNode): string | undefined {
  const body = node.childForFieldName('body');
  if (!body) return undefined;
  const first = body.namedChildren[0];
  if (first?.type === 'expression_statement') {
    const str = first.namedChildren[0];
    if (str?.type === 'string') {
      return str.text.replace(/^['"`]{1,3}|['"`]{1,3}$/g, '').trim();
    }
  }
  return undefined;
}

/**
 * Track variable assignments that create aliases for imported names:
 *   const x = new ClassName()      → x is an instance of ClassName
 *   const x = ClassName            → x is an alias of ClassName
 *   const x = imported.foo         → x is an alias of imported.foo
 *   const { a, b: c } = imported   → a, c are aliases
 *
 * Records these as ImportRecord entries (importKind='named') so that
 * resolveEdges can resolve `x.method()` to ClassName's methods.
 *
 * Limitations (safe failures — these just don't produce a record,
 * they don't produce wrong results):
 *   - Doesn't track reassignments (let x = ...; x = ...)
 *   - Doesn't track cross-function flow (x passed as argument)
 *   - Doesn't resolve `this.x = new Y()` (only top-level/局部 const)
 */
function trackVariableAssignment(
  node: Parser.SyntaxNode,
  filePath: string,
  imports: ImportRecord[]
): void {
  // Find the value (initializer) of the declaration
  // variable_declaration: const x = ...
  // lexical_declaration: const/let x = ...
  // Structure: [kind] [name_declarator (= value)?] [, name_declarator ...]
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type !== 'variable_declarator') continue;

    const nameNode = child.childForFieldName('name');
    const valueNode = child.childForFieldName('value');
    if (!nameNode || !valueNode) continue;

    const varName = nameNode.text;
    const line = (child.startPosition.row ?? 0) + 1;

    // Case 1: const x = new ClassName(...)
    if (valueNode.type === 'new_expression') {
      const ctorNode = valueNode.childForFieldName('constructor');
      if (ctorNode) {
        // ctorNode might be: identifier (Foo), member_expression (ns.Foo)
        const className = ctorNode.text;
        imports.push({
          sourceFile: filePath,
          targetFile: '',  // resolved later (file where ClassName is defined)
          targetModule: '',  // not an import, but a variable alias
          importedName: className,
          localAlias: varName,
          importKind: 'named',
          line,
        });
      }
    }
    // Case 2: const x = SomeIdentifier (simple alias of imported name)
    else if (valueNode.type === 'identifier') {
      imports.push({
        sourceFile: filePath,
        targetFile: '',
        targetModule: '',
        importedName: valueNode.text,
        localAlias: varName,
        importKind: 'named',
        line,
      });
    }
    // Case 3: const x = imported.foo (member access — alias of a property)
    else if (valueNode.type === 'member_expression') {
      // Store the full text (e.g., "imported.foo") as importedName
      imports.push({
        sourceFile: filePath,
        targetFile: '',
        targetModule: '',
        importedName: valueNode.text,
        localAlias: varName,
        importKind: 'named',
        line,
      });
    }
    // Case 4: destructuring const { a, b: c } = imported
    // (Less common, skip for simplicity — safe failure)
  }
}
