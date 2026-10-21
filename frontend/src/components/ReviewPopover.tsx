import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ReviewAnchor {
  x: number;
  y: number;
}

export function ReviewPopover({
  open,
  anchor,
  focusedLine,
  onNavigate,
  onNavigateFinding,
  onClose,
  children,
}: {
  open: boolean;
  anchor: ReviewAnchor;
  focusedLine: number;
  onNavigate?: (direction: -1 | 1) => void;
  onNavigateFinding?: (direction: -1 | 1) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [previousOpen, setPreviousOpen] = useState(open);
  const [exiting, setExiting] = useState(false);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    setExiting(!open);
  }
  const present = open || exiting;
  const [position, setPosition] = useState({
    top: 16,
    left: 16,
    maxHeight: 600,
  });

  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setExiting(false), 160);
    return () => clearTimeout(timer);
  }, [open]);

  useLayoutEffect(() => {
    const element = panel.current;
    const editor = element?.parentElement;
    if (!element || !editor || !present) return;
    const placePanel = () => {
      const bounds = editor.getBoundingClientRect();
      const codeBounds =
        editor.querySelector('.code-editor')?.getBoundingClientRect() ?? bounds;
      const line = editor.querySelector<HTMLElement>(
        `.code-line[data-line="${focusedLine}"]`,
      );
      const lineBounds = line?.getBoundingClientRect();
      let targetLeft = anchor.x;
      if (line) {
        const marks = Array.from(line.querySelectorAll('mark.guide-symbol'))
          .map((mark) => mark.getBoundingClientRect())
          .filter((rect) => rect.width > 0);
        if (marks.length) {
          targetLeft = Math.min(...marks.map((rect) => rect.left));
        } else {
          const range = document.createRange();
          range.selectNodeContents(line);
          // Exclude the trailing newline when measuring the code's text width.
          if (line.lastChild?.nodeType === Node.TEXT_NODE)
            range.setEndBefore(line.lastChild);
          const textBounds =
            typeof range.getBoundingClientRect === 'function'
              ? range.getBoundingClientRect()
              : undefined;
          if (textBounds && textBounds.width > 0) {
            targetLeft = textBounds.left;
          }
        }
      }
      const width = element.offsetWidth;
      const codeBottom =
        codeBounds.height > 0
          ? codeBounds.bottom - bounds.top
          : bounds.height - 32;
      const left = Math.max(
        16,
        Math.min(targetLeft - bounds.left, bounds.width - width - 16),
      );
      const targetBottom =
        lineBounds && lineBounds.height > 0 ? lineBounds.bottom : anchor.y;
      const flowBottom = Math.max(
        targetBottom,
        ...Array.from(
          editor.querySelectorAll<SVGPathElement>('.data-flow-track'),
        )
          .map((path) => path.getBoundingClientRect())
          .filter((rect) => rect.height > 0 || rect.width > 0)
          .map((rect) => rect.bottom + 5),
      );
      const top = Math.max(16, flowBottom - bounds.top + 32);
      const maxHeight = Math.max(0, Math.min(600, codeBottom - top - 16));
      setPosition((previous) =>
        previous.left === left &&
        previous.top === top &&
        previous.maxHeight === maxHeight
          ? previous
          : { left, top, maxHeight },
      );
    };
    placePanel();
    editor.addEventListener('scroll', placePanel, true);
    window.addEventListener('resize', placePanel);
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(placePanel)
        : undefined;
    observer?.observe(editor);
    observer?.observe(element);
    const flowLayer = editor.querySelector('.data-flow-overlay');
    const flowObserver =
      flowLayer && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(placePanel)
        : undefined;
    if (flowLayer)
      flowObserver?.observe(flowLayer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['d'],
      });
    return () => {
      editor.removeEventListener('scroll', placePanel, true);
      window.removeEventListener('resize', placePanel);
      observer?.disconnect();
      flowObserver?.disconnect();
    };
  }, [anchor, focusedLine, present, children]);

  useLayoutEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true });
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || panel.current?.contains(target))
        return;
      if (target.closest('[data-review-trigger], [data-review-surface]'))
        return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
      panel.current?.parentElement
        ?.querySelector<HTMLTextAreaElement>('textarea')
        ?.focus({ preventScroll: true });
    };
    document.addEventListener('click', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open, onClose]);

  if (!present) return null;
  return (
    <div
      ref={panel}
      className={`review-popover ${open ? 'is-open' : 'is-closing'}`}
      style={position}
      onKeyDown={(event) => {
        if (
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
            event.key,
          ) ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          event.nativeEvent.isComposing
        )
          return;
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest('input, textarea, select, [contenteditable="true"]')
        )
          return;
        const navigate =
          event.key === 'ArrowUp' || event.key === 'ArrowDown'
            ? onNavigateFinding
            : onNavigate;
        if (!navigate) return;
        event.preventDefault();
        event.stopPropagation();
        // Keep focus in the dialog if switching findings replaces the focused step button.
        event.currentTarget.focus({ preventScroll: true });
        navigate(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
      }}
      role="dialog"
      tabIndex={-1}
      aria-label="Review guide"
      aria-hidden={!open}
      inert={!open}
    >
      {children}
    </div>
  );
}
