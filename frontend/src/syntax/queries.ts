import type { Language as Grammar } from 'web-tree-sitter';
import type { Language } from '../types/review';

export type ParsedLanguage = Exclude<Language, 'unknown'>;

const script = `
(comment) @comment
[(string) (template_string) (regex)] @string
(number) @number
[(true) (false) (null) (undefined)] @constant
(identifier) @variable
(property_identifier) @property
(function_declaration name: (identifier) @function)
(call_expression function: (identifier) @function)
(call_expression function: (member_expression property: (property_identifier) @function))
(new_expression constructor: (identifier) @type)
(jsx_opening_element name: (identifier) @tag)
(jsx_closing_element name: (identifier) @tag)
(jsx_self_closing_element name: (identifier) @tag)
(jsx_text) @string
`;
const patterns: Record<ParsedLanguage, string> = {
  javascript: script,
  typescript:
    script +
    `
(type_identifier) @type
(predefined_type) @type
`,
  python: `
(comment) @comment
(string) @string
[(integer) (float)] @number
[(true) (false) (none)] @constant
(identifier) @variable
(attribute attribute: (identifier) @property)
(function_definition name: (identifier) @function)
(call function: (identifier) @function)
(call function: (attribute attribute: (identifier) @function))
(class_definition name: (identifier) @type)
`,
  rust: `
[(line_comment) (block_comment)] @comment
[(string_literal) (raw_string_literal) (char_literal)] @string
[(integer_literal) (float_literal)] @number
(boolean_literal) @constant
(identifier) @variable
(field_identifier) @property
(type_identifier) @type
(function_item name: (identifier) @function)
(call_expression function: (identifier) @function)
`,
  java: `
[(line_comment) (block_comment)] @comment
[(string_literal) (character_literal)] @string
[(decimal_integer_literal) (decimal_floating_point_literal)] @number
[(true) (false) (null_literal)] @constant
(identifier) @variable
(type_identifier) @type
(method_declaration name: (identifier) @function)
(method_invocation name: (identifier) @function)
(class_declaration name: (identifier) @type)
`,
  go: `
(comment) @comment
[(interpreted_string_literal) (raw_string_literal) (rune_literal)] @string
[(int_literal) (float_literal) (imaginary_literal)] @number
[(true) (false) (nil) (iota)] @constant
(identifier) @variable
(field_identifier) @property
(type_identifier) @type
(package_identifier) @namespace
(function_declaration name: (identifier) @function)
(method_declaration name: (field_identifier) @function)
(call_expression function: (identifier) @function)
(call_expression function: (selector_expression field: (field_identifier) @function))
`,
};
const keywords: Record<ParsedLanguage, string[]> = {
  javascript: [
    'async',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'from',
    'function',
    'get',
    'if',
    'import',
    'in',
    'instanceof',
    'let',
    'new',
    'of',
    'return',
    'set',
    'static',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
  ],
  typescript: [
    'abstract',
    'as',
    'asserts',
    'async',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'constructor',
    'continue',
    'declare',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'finally',
    'for',
    'from',
    'function',
    'get',
    'if',
    'implements',
    'import',
    'in',
    'infer',
    'instanceof',
    'interface',
    'is',
    'keyof',
    'let',
    'namespace',
    'new',
    'of',
    'override',
    'private',
    'protected',
    'public',
    'readonly',
    'return',
    'satisfies',
    'set',
    'static',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'type',
    'typeof',
    'var',
    'void',
    'while',
    'yield',
  ],
  python: [
    'and',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'case',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'match',
    'nonlocal',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
    'yield',
  ],
  rust: [
    'as',
    'async',
    'await',
    'break',
    'const',
    'continue',
    'else',
    'enum',
    'extern',
    'fn',
    'for',
    'if',
    'impl',
    'in',
    'let',
    'loop',
    'match',
    'mod',
    'move',
    'mut',
    'pub',
    'ref',
    'return',
    'self',
    'Self',
    'static',
    'struct',
    'super',
    'trait',
    'type',
    'unsafe',
    'use',
    'where',
    'while',
  ],
  java: [
    'abstract',
    'assert',
    'boolean',
    'break',
    'byte',
    'case',
    'catch',
    'char',
    'class',
    'const',
    'continue',
    'default',
    'do',
    'double',
    'else',
    'enum',
    'extends',
    'final',
    'finally',
    'float',
    'for',
    'if',
    'implements',
    'import',
    'instanceof',
    'int',
    'interface',
    'long',
    'native',
    'new',
    'package',
    'private',
    'protected',
    'public',
    'record',
    'return',
    'short',
    'static',
    'super',
    'switch',
    'synchronized',
    'this',
    'throw',
    'throws',
    'transient',
    'try',
    'var',
    'void',
    'volatile',
    'while',
    'yield',
  ],
  go: [
    'break',
    'case',
    'chan',
    'const',
    'continue',
    'default',
    'defer',
    'else',
    'fallthrough',
    'for',
    'func',
    'go',
    'goto',
    'if',
    'import',
    'interface',
    'map',
    'package',
    'range',
    'return',
    'select',
    'struct',
    'switch',
    'type',
    'var',
  ],
};

// These queries match parser nodes, including nodes within error-recovered trees.
// Restrict anonymous terminals to those present in the pinned grammar's symbol table.
export function highlightQuery(
  language: ParsedLanguage,
  grammar: Grammar,
): string {
  const terminals = new Set(grammar.types);
  const named = new Set(
    grammar.types.filter((_, index) => grammar.nodeTypeIsNamed(index)),
  );
  const anonymous = new Set(
    grammar.types.filter((_, index) => !grammar.nodeTypeIsNamed(index)),
  );
  const group = (values: string[], capture: string) => {
    const supported = values.filter((value) => terminals.has(value));
    return supported.length
      ? `[${supported.map((value) => (anonymous.has(value) ? JSON.stringify(value) : named.has(value) ? `(${value})` : '')).join(' ')}] @${capture}\n`
      : '';
  };
  return (
    patterns[language] +
    group(keywords[language], 'keyword') +
    group(
      [
        '+',
        '-',
        '*',
        '/',
        '%',
        '=',
        ':=',
        '==',
        '===',
        '!=',
        '!==',
        '<',
        '>',
        '<=',
        '>=',
        '=>',
        '+=',
        '-=',
        '&&',
        '||',
        '!',
        '&',
        '|',
        '??',
        '?.',
      ],
      'operator',
    ) +
    group(['(', ')', '[', ']', '{', '}', ',', ';', ':', '.'], 'punctuation')
  );
}
