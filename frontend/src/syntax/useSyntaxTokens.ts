import { useEffect, useMemo, useState } from 'react';
import type { Language } from '../types/review';
import { loadHighlighter } from './loader';
import type { SyntaxHighlighter, SyntaxToken } from './engine';

export function useSyntaxTokens(
  code: string,
  language: Language,
): SyntaxToken[][] {
  const [ready, setReady] = useState<{
    language: Language;
    highlighter: SyntaxHighlighter;
  }>();
  useEffect(() => {
    if (language === 'unknown') return;
    let cancelled = false;
    void loadHighlighter(language)
      .then((highlighter) => {
        if (!cancelled) setReady({ language, highlighter });
      })
      .catch(() => {
        if (!cancelled) setReady(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);
  const highlighter =
    ready?.language === language ? ready.highlighter : undefined;
  return useMemo(() => {
    if (!highlighter || !code) return [];
    try {
      return highlighter.highlight(code);
    } catch {
      return [];
    }
  }, [code, highlighter]);
}
