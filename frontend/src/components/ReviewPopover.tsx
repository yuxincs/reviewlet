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
  onClose,
  children,
}: {
  open: boolean;
  anchor: ReviewAnchor;
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

  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setExiting(false), 160);
    return () => clearTimeout(timer);
  }, [open]);

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
