import { useId, useRef, type UIEvent } from 'react';
import type { Finding, Language, Severity } from '../types/review';
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
  findings,
  disabled,
}: {
  code: string;
  language: Language;
  onChange: (code: string) => void;
  onBlur?: () => void;
  findings: Finding[];
  disabled: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = code.split('\n');
  const findingsDescription = useId();
  const lineFindings = new Map<
    number,
    { severity: Severity; titles: string[] }
  >();
  const priority = { high: 0, medium: 1, low: 2 };
  for (const finding of findings) {
    for (
      let line = Math.max(1, finding.lineStart);
      line <= Math.min(lines.length, finding.lineEnd);
      line++
    ) {
      const existing = lineFindings.get(line);
      lineFindings.set(line, {
        severity:
          existing && priority[existing.severity] < priority[finding.severity]
            ? existing.severity
            : finding.severity,
        titles: [...(existing?.titles ?? []), finding.title],
      });
    }
  }
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
              className={
                lineFindings.has(index + 1)
                  ? `finding-line-number finding-line-${lineFindings.get(index + 1)!.severity}`
                  : ''
              }
              title={lineFindings.get(index + 1)?.titles.join(' · ')}
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
              className={`code-line ${lineFindings.has(index + 1) ? `finding-line finding-line-${lineFindings.get(index + 1)!.severity}` : ''}`}
              data-line={index + 1}
            >
              {highlight(line)}
              {'\n'}
            </span>
          ))}
        </pre>
        <textarea
          ref={textarea}
          aria-label="Code snippet"
          aria-describedby={findings.length ? findingsDescription : undefined}
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
      {findings.length > 0 && (
        <ul id={findingsDescription} className="sr-only">
          {findings.map((finding) => (
            <li key={finding.id}>
              {finding.severity} priority, line {finding.lineStart}
              {finding.lineEnd !== finding.lineStart
                ? `–${finding.lineEnd}`
                : ''}
              : {finding.title}
            </li>
          ))}
        </ul>
      )}
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
