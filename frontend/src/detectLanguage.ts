import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import type { Language } from './types/review';

// Register only supported languages; detection never modifies the editor DOM.
const detector = hljs.newInstance();
detector.registerLanguage('javascript', javascript);
detector.registerLanguage('typescript', typescript);
detector.registerLanguage('python', python);
detector.registerLanguage('go', go);

export const LANGUAGE_DETECTION_DELAY = 350;

export function detectLanguage(code: string): Language {
  if (!code.trim()) return 'unknown';
  const result = detector.highlightAuto(code);
  // A lone generic keyword is insufficient evidence for changing metadata.
  if (result.relevance < 2) return 'unknown';
  switch (result.language) {
    case 'javascript':
    case 'typescript':
    case 'python':
    case 'go':
      return result.language;
    default:
      return 'unknown';
  }
}
