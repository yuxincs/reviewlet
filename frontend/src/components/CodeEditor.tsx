import { useEffect, useRef, type UIEvent } from 'react';
import type { Language } from '../types/review';
import { languageLabels } from '../languages';
import { Icon } from './Icon';

const keywords =
  /^(import|from|export|async|await|function|const|let|return|if|else|null|undefined|def|func|string|error|type|interface)$/;
function highlight(line: string) {
  return line
    .split(/('[^']*'|"[^"]*"|`[^`]*`|\/\/.*$|#.*$|\b\w+\b)/g)
    .map((token, index) => {
      const kind =
        token.startsWith('//') || token.startsWith('#')
          ? 'comment'
          : /^['"`]/.test(token)
            ? 'string'
            : keywords.test(token)
              ? 'keyword'
              : /^\d+$/.test(token)
                ? 'number'
                : '';
      return (
        <span key={index} className={kind ? `token-${kind}` : undefined}>
          {token}
        </span>
      );
    });
}

export function CodeEditor({
  code,
  language,
  onChange,
  onBlur,
  highlightedLine,
  disabled,
}: {
  code: string;
  language: Language;
  onChange: (code: string) => void;
  onBlur?: () => void;
  highlightedLine: number | null;
  disabled: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = code.split('\n');
  useEffect(() => {
    if (highlightedLine !== null && textarea.current) {
      textarea.current.scrollTop = Math.max(0, (highlightedLine - 4) * 25);
      if (highlightRef.current)
        highlightRef.current.scrollTop = textarea.current.scrollTop;
      if (gutter.current) gutter.current.scrollTop = textarea.current.scrollTop;
    }
  }, [highlightedLine]);
  function syncScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = event.currentTarget.scrollTop;
      highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
    if (gutter.current)
      gutter.current.scrollTop = event.currentTarget.scrollTop;
  }
  return (
    <div className="editor-shell">
      <div className="code-editor">
        <div className="line-numbers" ref={gutter} aria-hidden="true">
          {lines.map((_, index) => (
            <span
              className={highlightedLine === index + 1 ? 'active-line' : ''}
              key={index}
            >
              {index + 1}
            </span>
          ))}
        </div>
        <pre ref={highlightRef} className="highlight-code" aria-hidden="true">
          {lines.map((line, index) => (
            <span
              key={index}
              className={`code-line ${highlightedLine === index + 1 ? 'highlight-line' : ''}`}
            >
              {highlight(line)}
              {'\n'}
            </span>
          ))}
        </pre>
        <textarea
          ref={textarea}
          aria-label="Code snippet"
          value={code}
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
          onBlur={onBlur}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="code-input"
          wrap="off"
          maxLength={30_000}
          disabled={disabled}
        />
        {!code && (
          <span className="editor-placeholder" aria-hidden="true">
            // Paste your code here. A function is a great place to start.
          </span>
        )}
      </div>
      <div className="editor-status">
        <span>
          <span className="status-dot" />
          {languageLabels[language]}
        </span>
        <span>
          {lines.length} lines <span className="status-separator">|</span>{' '}
          {code.length.toLocaleString()} / 30,000 characters{' '}
          <Icon name="code" size={14} />
        </span>
      </div>
    </div>
  );
}
