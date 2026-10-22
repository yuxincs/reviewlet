import { expect, it } from 'vitest';
import { detectLanguage } from './detectLanguage';

it.each([
  ['', 'unknown'],
  ['  \n', 'unknown'],
  ['hello world', 'unknown'],
  ['const result = 1 + 2;', 'unknown'],
  ['function greet(name) { return name.toUpperCase(); }', 'javascript'],
  ['const answer: number = 42;', 'typescript'],
  ['def greet(name):\n    return f"Hello, {name}"', 'python'],
  ['package main\nimport "fmt"\nfunc main() { fmt.Println("hello") }', 'go'],
])('detects %j as %s', (code, language) => {
  expect(detectLanguage(code)).toBe(language);
});
