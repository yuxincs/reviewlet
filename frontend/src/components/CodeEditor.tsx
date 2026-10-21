import { useLayoutEffect, useId, useRef, type UIEvent } from 'react';
import type { Finding, Language, Severity } from '../types/review';
import type { ReviewAnchor } from './ReviewPopover';
import {
  flowColor,
  useFlowPalette,
  flowStyleForHue,
  referenceKey,
  type FlowColor,
} from '../flowColors';
import { DataFlowOverlay } from './DataFlowOverlay';
import type { GuideRange, GuideFlowNode } from '../demoReviewGuide';
import { languageLabels } from '../languages';
import { Icon } from './Icon';

const keywords =
  /^(import|from|export|async|await|function|const|let|return|if|else|null|undefined|def|func|string|error|type|interface)$/;
function highlight(
  line: string,
  ranges: GuideRange[],
  dimContext: boolean,
  colors: Map<string, FlowColor>,
  palette: ReturnType<typeof useFlowPalette>,
) {
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
                className={`guide-symbol guide-role-${range.role} flow-color`}
                style={flowStyleForHue(
                  colors.get(referenceKey(range)) ??
                    flowColor(
                      { label: range.symbol, reference: range },
                      palette,
                    ),
                )}
                data-symbol={range.symbol}
                data-reference={`${range.line}:${range.startColumn}:${range.endColumn}`}
              >
                {text}
              </mark>
            ) : (
              <span
                key={part}
                className={dimContext ? 'guide-context' : undefined}
              >
                {text}
              </span>
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
  reviewFocus,
  flowNodes = [],
  flowConnections,
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
  reviewFocus?: { lineStart: number; lineEnd: number };
  flowNodes?: GuideFlowNode[];
  flowConnections?: { from: number; to: number }[];
  focusedLine?: number;
  onReviewLine?: (line: number, anchor: ReviewAnchor) => void;
  onDismissReview?: () => void;
  disabled: boolean;
}) {
  const palette = useFlowPalette();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = code.split('\n');
  const colors = new Map(
    flowNodes.flatMap((node) =>
      node.reference
        ? [[referenceKey(node.reference), flowColor(node, palette)] as const]
        : [],
    ),
  );
  const isRelevantLine = (line: number) =>
    !reviewFocus ||
    (linkedRanges.length > 0
      ? linkedRanges.some((range) => range.line === line)
      : line >= reviewFocus.lineStart && line <= reviewFocus.lineEnd);
  const dimmedClass = (line: number) =>
    isRelevantLine(line) ? '' : 'guide-dimmed';
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
  useLayoutEffect(() => {
    const input = textarea.current;
    if (focusedLine === undefined || !input || input.clientHeight === 0) return;
    const style = getComputedStyle(input);
    const lineHeight = parseFloat(style.lineHeight);
    const padding = parseFloat(style.paddingTop);
    const top = padding + (focusedLine - 1) * lineHeight;
    const spaceBelow = reviewFocus
      ? Math.min(320, input.clientHeight * 0.45)
      : padding;
    if (top < input.scrollTop + padding) {
      input.scrollTop = Math.max(0, top - padding);
    } else if (
      top + lineHeight >
      input.scrollTop + input.clientHeight - spaceBelow
    ) {
      input.scrollTop = Math.max(
        0,
        top + lineHeight - input.clientHeight + spaceBelow,
      );
    }
    if (highlightRef.current) highlightRef.current.scrollTop = input.scrollTop;
    if (gutter.current) gutter.current.scrollTop = input.scrollTop;
  }, [focusedLine, reviewFocus]);
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
      <div className={`code-editor ${reviewFocus ? 'review-focused' : ''}`}>
        <div className="line-numbers" ref={gutter}>
          {lines.map((_, index) =>
            lineFindings.has(index + 1) && onReviewLine ? (
              <button
                key={index}
                type="button"
                className={`finding-line-number finding-line-${lineFindings.get(index + 1)!.severity} ${dimmedClass(index + 1)}`}
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
                className={`${lineFindings.has(index + 1) ? `finding-line-number finding-line-${lineFindings.get(index + 1)!.severity}` : ''} ${dimmedClass(index + 1)}`}
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
              className={`code-line ${lineFindings.has(index + 1) ? `finding-line finding-line-${lineFindings.get(index + 1)!.severity}` : ''} ${linkedRanges.some((range) => range.line === index + 1) ? 'guide-linked-line' : ''} ${dimmedClass(index + 1)}`}
              data-line={index + 1}
            >
              {highlight(
                line,
                linkedRanges.filter((range) => range.line === index + 1),
                Boolean(
                  reviewFocus &&
                  linkedRanges.some((range) => range.line === index + 1),
                ),
                colors,
                palette,
              )}
              {'\n'}
            </span>
          ))}
        </pre>
        {flowNodes.length > 0 && (
          <DataFlowOverlay nodes={flowNodes} connections={flowConnections} />
        )}
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
