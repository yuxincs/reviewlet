import { useEffect, useId, useRef, type UIEvent } from 'react';
import type { Finding, Language, Severity } from '../types/review';
import type { ReviewAnchor } from './ReviewPopover';
import type { GuideRange } from '../demoReviewGuide';
import { languageLabels } from '../languages';
import { Icon } from './Icon';

const keywords =
  /^(import|from|export|async|await|function|const|let|return|if|else|null|undefined|def|func|string|error|type|interface)$/;
function highlight(line: string, ranges: GuideRange[]) {
  let offset = 0;
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
      const start = offset;
      offset += token.length;
      const boundaries = [
        start,
        ...ranges
          .flatMap((range) => [range.startColumn - 1, range.endColumn - 1])
          .filter((column) => column > start && column < offset),
        offset,
      ].sort((a, b) => a - b);
      return (
        <span key={index} className={kind ? `token-${kind}` : undefined}>
          {boundaries.slice(0, -1).map((column, part) => {
            const range = ranges.find(
              (range) =>
                column >= range.startColumn - 1 && column < range.endColumn - 1,
            );
            const text = line.slice(column, boundaries[part + 1]);
            return range ? (
              <mark
                key={part}
                className={`guide-symbol guide-role-${range.role}`}
                data-symbol={range.symbol}
              >
                {text}
              </mark>
            ) : (
              text
            );
          })}
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
  linkedRanges = [],
  focusedLine,
  onReviewLine,
  onDismissReview,
  disabled,
}: {
  code: string;
  language: Language;
  onChange: (code: string) => void;
  onBlur?: () => void;
  findings: Finding[];
  linkedRanges?: GuideRange[];
  focusedLine?: number;
  onReviewLine?: (line: number, anchor: ReviewAnchor) => void;
  onDismissReview?: () => void;
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
  useEffect(() => {
    if (focusedLine === undefined || !textarea.current) return;
    const top = Math.max(0, (focusedLine - 3) * 25);
    textarea.current.scrollTop = top;
    if (highlightRef.current)
      highlightRef.current.scrollTop = textarea.current.scrollTop;
    if (gutter.current) gutter.current.scrollTop = textarea.current.scrollTop;
  }, [focusedLine]);
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
        <div className="line-numbers" ref={gutter}>
          {lines.map((_, index) =>
            lineFindings.has(index + 1) && onReviewLine ? (
              <button
                key={index}
                type="button"
                className={`finding-line-number finding-line-${lineFindings.get(index + 1)!.severity}`}
                data-review-trigger
                disabled={disabled}
                aria-label={`Show review for line ${index + 1}`}
                aria-haspopup="dialog"
                title={lineFindings.get(index + 1)?.titles.join(' · ')}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  onReviewLine(index + 1, {
                    x: bounds.right,
                    y: bounds.bottom,
                  });
                }}
              >
                {index + 1}
              </button>
            ) : (
              <span
                aria-hidden="true"
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
            ),
          )}
        </div>
        <pre ref={highlightRef} className="highlight-code" aria-hidden="true">
          {lines.map((line, index) => (
            <span
              key={index}
              className={`code-line ${lineFindings.has(index + 1) ? `finding-line finding-line-${lineFindings.get(index + 1)!.severity}` : ''} ${linkedRanges.some((range) => range.line === index + 1) ? 'guide-linked-line' : ''}`}
              data-line={index + 1}
            >
              {highlight(
                line,
                linkedRanges.filter((range) => range.line === index + 1),
              )}
              {'\n'}
            </span>
          ))}
        </pre>
        <textarea
          ref={textarea}
          aria-label="Code snippet"
          aria-describedby={findings.length ? findingsDescription : undefined}
          value={code}
          data-review-surface
          onClick={(event) => {
            const input = event.currentTarget;
            const style = getComputedStyle(input);
            const line =
              Math.floor(
                (event.clientY -
                  input.getBoundingClientRect().top -
                  parseFloat(style.paddingTop) +
                  input.scrollTop) /
                  parseFloat(style.lineHeight),
              ) + 1;
            if (
              input.selectionStart !== input.selectionEnd ||
              !lineFindings.has(line)
            ) {
              onDismissReview?.();
              return;
            }
            onReviewLine?.(line, { x: event.clientX, y: event.clientY });
          }}
          onKeyDown={(event) => {
            if (
              event.key !== 'Enter' ||
              !event.altKey ||
              event.metaKey ||
              event.ctrlKey ||
              event.nativeEvent.isComposing
            )
              return;
            const line = code
              .slice(0, event.currentTarget.selectionStart)
              .split('\n').length;
            if (!lineFindings.has(line)) return;
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            const style = getComputedStyle(event.currentTarget);
            onReviewLine?.(line, {
              x: bounds.left + 40,
              y:
                bounds.top +
                parseFloat(style.paddingTop) +
                line * parseFloat(style.lineHeight) -
                event.currentTarget.scrollTop,
            });
          }}
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
        <div id={findingsDescription} className="sr-only">
          Click a highlighted line or its line number to read the review. Press
          Alt+Enter on a highlighted line to open it with the keyboard.
          <ul>
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
        </div>
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
