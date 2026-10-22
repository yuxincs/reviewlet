import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import type { Language } from './types/review';

// Register only supported languages; detection never modifies the editor DOM.
const detector = hljs.newInstance();
detector.registerLanguage('java', java);
detector.registerLanguage('javascript', javascript);
detector.registerLanguage('typescript', typescript);
detector.registerLanguage('python', python);
detector.registerLanguage('go', go);
detector.registerLanguage('rust', rust);

export const LANGUAGE_DETECTION_DELAY = 350;

export function detectLanguage(code: string): Language {
  if (!code.trim()) return 'unknown';
  const result = detector.highlightAuto(code);
  // Shared class keywords can make TypeScript outrank Java. A Java-style
  // return type before a method name disambiguates common declarations.
  if (
    result.language === 'typescript' &&
    /\b(?:void|int|long|boolean|byte|short|char|float|double|String)\s+[A-Za-z_$][\w$]*\s*\(/.test(
      code,
    )
  ) {
    const javaResult = detector.highlight(code, { language: 'java' });
    if (!javaResult.illegal && javaResult.relevance >= 2) return 'java';
  }
  // A lone generic keyword is insufficient evidence for changing metadata.
  if (result.relevance < 2) return 'unknown';
  switch (result.language) {
    case 'javascript':
    case 'typescript':
    case 'python':
    case 'go':
    case 'rust':
    case 'java':
      return result.language;
    default:
      return 'unknown';
  }
}
