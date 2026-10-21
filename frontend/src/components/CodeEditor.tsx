import { useLayoutEffect, useId, useRef, type UIEvent } from 'react';
import type { Finding, Language, Severity } from '../types/review';
import type { ReviewAnchor } from './ReviewPopover';
import { flowColor, useFlowPalette, referenceKey } from '../flowColors';
import { DataFlowOverlay } from './DataFlowOverlay';
import { CodeSamples } from './CodeSamples';
import { CodeHighlight } from './CodeHighlight';
import type { GuideRange, GuideFlowNode } from '../demoReviewGuide';
import { languageLabels } from '../languages';
import { Icon } from './Icon';
import type { CodeEdit } from '../codeEdits';

export function CodeEditor({
  code,
  fixPreview,
  language,
  onChange,
  onBlur,
  findings,
  linkedRanges = [],
  reviewFocus,
  flowNodes = [],
  sampleNodes = [],
  flowConnections,
  focusedLine,
  onReviewLine,
  onDismissReview,
  disabled,
}: {
  code: string;
  fixPreview?: {
    edit: CodeEdit;
    title: string;
    onApply: () => void;
    onBack: () => void;
  };
  language: Language;
  onChange: (code: string) => void;
  onBlur?: () => void;
  findings: Finding[];
  linkedRanges?: GuideRange[];
  reviewFocus?: { lineStart: number; lineEnd: number };
  flowNodes?: GuideFlowNode[];
  sampleNodes?: GuideFlowNode[];
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
  const editor = useRef<HTMLDivElement>(null);
  const fixActions = useRef<HTMLDivElement>(null);
  const savedScroll = useRef<{ top: number; left: number } | undefined>(
    undefined,
  );
  const lines = code.split('\n');
  const added = fixPreview?.edit.replacement
    ? fixPreview.edit.replacement.split('\n')
    : [];
  const extraLines = added.length + (fixPreview ? 2 : 0);
  const extraColumns = Math.max(
    0,
    Math.max(0, ...added.map((line) => line.length)) -
      Math.max(0, ...lines.map((line) => line.length)),
  );
  const displayLines = lines.flatMap((text, index) => {
    const number = index + 1;
    const removed =
      fixPreview &&
      number >= fixPreview.edit.startLine &&
      number <= fixPreview.edit.endLine;
    const row = {
      text,
      number,
      key: `source-${number}`,
      kind: removed ? 'removed' : 'context',
    };
    return fixPreview && number === fixPreview.edit.endLine
      ? [
          row,
          ...added.map((text, i) => ({
            text,
            number: fixPreview.edit.startLine + i,
            key: `added-${i}`,
            kind: 'added',
          })),
          { text: '', number: 0, key: 'fix-actions', kind: 'actions' },
        ]
      : [row];
  });
  const colors = new Map(
    flowNodes.flatMap((node) =>
      node.reference
        ? [[referenceKey(node.reference), flowColor(node, palette)] as const]
        : [],
    ),
  );
  const isRelevantLine = (line: number) =>
    fixPreview
      ? line >= fixPreview.edit.startLine && line <= fixPreview.edit.endLine
      : !reviewFocus ||
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
  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    if (fixPreview && !savedScroll.current) {
      savedScroll.current = { top: input.scrollTop, left: input.scrollLeft };
      editor.current?.focus({ preventScroll: true });
    } else if (!fixPreview && savedScroll.current) {
      input.scrollTop = savedScroll.current.top;
      input.scrollLeft = savedScroll.current.left;
      savedScroll.current = undefined;
    }
    if (highlightRef.current) {
      highlightRef.current.scrollTop = input.scrollTop;
      highlightRef.current.scrollLeft = input.scrollLeft;
    }
    if (gutter.current) gutter.current.scrollTop = input.scrollTop;
    if (fixActions.current)
      fixActions.current.style.transform = `translateY(${-input.scrollTop}px)`;
  }, [fixPreview]);
  function syncScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = event.currentTarget.scrollTop;
      highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
    if (gutter.current)
      gutter.current.scrollTop = event.currentTarget.scrollTop;
    if (fixActions.current)
      fixActions.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
  }
  return (
    <div className="editor-shell">
      <div
        ref={editor}
        className={`code-editor ${reviewFocus ? 'review-focused' : ''} ${fixPreview ? 'has-fix-preview' : ''}`}
        role={fixPreview ? 'region' : undefined}
        aria-label={fixPreview ? 'Suggested fix preview' : undefined}
        aria-description={fixPreview?.title}
        tabIndex={fixPreview ? -1 : undefined}
        onKeyDown={(event) => {
          if (!fixPreview) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            fixPreview.onBack();
          } else if (
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)
          ) {
            const input = textarea.current;
            if (!input) return;
            event.preventDefault();
            input.scrollTop +=
              (event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 1) *
              (event.key.startsWith('Page') ? input.clientHeight : 25);
            if (highlightRef.current)
              highlightRef.current.scrollTop = input.scrollTop;
            if (gutter.current) gutter.current.scrollTop = input.scrollTop;
            if (fixActions.current)
              fixActions.current.style.transform = `translateY(${-input.scrollTop}px)`;
          }
        }}
      >
        <div className="line-numbers" ref={gutter}>
          {displayLines.map((row) =>
            row.kind === 'actions' ? (
              <span
                key={row.key}
                className="inline-fix-gutter-space"
                aria-hidden="true"
              />
            ) : fixPreview ? (
              <span
                key={row.key}
                aria-hidden="true"
                className={`${row.kind === 'context' ? 'guide-dimmed' : `inline-fix-gutter-${row.kind}`}`}
              >
                {row.kind === 'removed'
                  ? '−'
                  : row.kind === 'added'
                    ? '+'
                    : row.number}
              </span>
            ) : lineFindings.has(row.number) && onReviewLine ? (
              <button
                key={row.key}
                type="button"
                className={`finding-line-number finding-line-${lineFindings.get(row.number)!.severity} ${dimmedClass(row.number)}`}
                data-review-trigger
                disabled={disabled}
                aria-label={`Show review for line ${row.number}`}
                aria-haspopup="dialog"
                title={lineFindings.get(row.number)?.titles.join(' · ')}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  onReviewLine(row.number, {
                    x: bounds.right,
                    y: bounds.bottom,
                  });
                }}
              >
                {row.number}
              </button>
            ) : (
              <span
                key={row.key}
                aria-hidden="true"
                className={`${lineFindings.has(row.number) ? `finding-line-number finding-line-${lineFindings.get(row.number)!.severity}` : ''} ${dimmedClass(row.number)}`}
                title={lineFindings.get(row.number)?.titles.join(' · ')}
              >
                {row.number}
              </span>
            ),
          )}
        </div>
        <pre
          ref={highlightRef}
          className="highlight-code"
          aria-hidden={!fixPreview}
          role={fixPreview ? 'group' : undefined}
          aria-label={fixPreview ? 'Proposed change' : undefined}
        >
          {displayLines.map((row) =>
            row.kind === 'actions' ? (
              <span key={row.key} className="code-line inline-fix-space">
                {'\n\n'}
              </span>
            ) : (
              <span
                key={row.key}
                className={`code-line ${fixPreview ? (row.kind === 'context' ? 'guide-dimmed' : `fix-diff-${row.kind}`) : `${lineFindings.has(row.number) ? `finding-line finding-line-${lineFindings.get(row.number)!.severity}` : ''} ${linkedRanges.some((range) => range.line === row.number) ? 'guide-linked-line' : ''} ${dimmedClass(row.number)}`}`}
                data-line={row.kind === 'added' ? undefined : row.number}
              >
                {fixPreview && row.kind !== 'context' && (
                  <span className="sr-only">
                    {row.kind === 'added' ? 'Added line: ' : 'Removed line: '}
                  </span>
                )}
                <CodeHighlight
                  line={row.text}
                  ranges={
                    fixPreview
                      ? []
                      : linkedRanges.filter(
                          (range) => range.line === row.number,
                        )
                  }
                  dimContext={Boolean(
                    !fixPreview &&
                    reviewFocus &&
                    linkedRanges.some((range) => range.line === row.number),
                  )}
                  colors={colors}
                />
                {'\n'}
              </span>
            ),
          )}
        </pre>
        {!fixPreview && flowNodes.length > 0 && (
          <DataFlowOverlay nodes={flowNodes} connections={flowConnections} />
        )}
        {!fixPreview && sampleNodes.length > 0 && (
          <CodeSamples nodes={sampleNodes} />
        )}
        <textarea
          ref={textarea}
          aria-label="Code snippet"
          aria-describedby={findings.length ? findingsDescription : undefined}
          value={code}
          readOnly={Boolean(fixPreview)}
          tabIndex={fixPreview ? -1 : undefined}
          style={
            fixPreview
              ? {
                  paddingBottom: `calc(min(320px, 45dvh) + ${extraLines * 25}px)`,
                  paddingRight: `calc(14px + ${extraColumns}ch)`,
                }
              : undefined
          }
          onMouseDown={(event) => {
            if (fixPreview) event.preventDefault();
          }}
          data-review-surface
          onClick={(event) => {
            if (fixPreview) return;
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
            if (fixPreview) return;
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
        {fixPreview && (
          <div
            ref={fixActions}
            className="inline-fix-actions"
            data-review-trigger
            style={{
              top: `calc(var(--editor-padding-top) + ${(fixPreview.edit.endLine + added.length) * 25}px)`,
            }}
          >
            <button className="primary-button" onClick={fixPreview.onApply}>
              <Icon name="check" size={15} />
              Apply fix
            </button>
            <button
              className="fix-preview-back"
              onClick={fixPreview.onBack}
              aria-keyshortcuts="Escape"
              title="Back to explanation (Esc)"
            >
              <span>Back to explanation</span>
              <kbd aria-hidden="true">
                <Icon name="escape" size={14} />
              </kbd>
            </button>
          </div>
        )}
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
          {fixPreview && (
            <span className="inline-fix-status"> · Previewing fix</span>
          )}
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
