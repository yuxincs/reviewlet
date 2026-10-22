import { useRef } from 'react';
import { minSidebarWidth } from '../useSidebarWidth';

export function SidebarResizer({
  width,
  displayedWidth,
  onDragWidth,
  collapsed,
  onExpand,
  maxWidth,
  onChange,
  onResizingChange,
  onCollapse,
}: {
  collapsed: boolean;
  onExpand: () => void;
  width: number;
  displayedWidth: number;
  onDragWidth: (width: number) => void;
  maxWidth: number;
  onChange: (width: number) => void;
  onResizingChange: (resizing: boolean) => void;
  onCollapse: () => void;
}) {
  const drag = useRef<
    { offset: number; pointerId: number; collapsed: boolean } | undefined
  >(undefined);
  function stop() {
    if (!drag.current) return;
    drag.current = undefined;
    onResizingChange(false);
  }
  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-controls="snippet-sidebar"
      aria-valuemin={72}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(displayedWidth)}
      aria-valuetext={
        collapsed ? 'Collapsed' : `${Math.round(displayedWidth)} pixels`
      }
      tabIndex={0}
      title="Drag to resize; drag below the minimum to collapse. Arrow keys adjust; double-click resets."
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        // Freeze the visible edge if a collapse/expand animation is still running.
        const bounds = event.currentTarget.getBoundingClientRect();
        const visibleWidth =
          bounds.width > 0 ? bounds.left + bounds.width / 2 : displayedWidth;
        drag.current = {
          offset: event.clientX - visibleWidth,
          pointerId: event.pointerId,
          collapsed,
        };
        onDragWidth(visibleWidth);
        onResizingChange(true);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        // Use the visible edge, never the remembered expanded width. Keep
        // pointer capture through both directions of the collapse threshold.
        const next = Math.max(
          72,
          Math.min(maxWidth, event.clientX - drag.current.offset),
        );
        onDragWidth(next);
        const nextCollapsed = next < minSidebarWidth;
        if (nextCollapsed !== drag.current.collapsed) {
          drag.current.collapsed = nextCollapsed;
          if (nextCollapsed) onCollapse();
          else onExpand();
        }
        if (!nextCollapsed) onChange(next);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        stop();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={() => {
        onExpand();
        onChange(360);
      }}
      onKeyDown={(event) => {
        if (collapsed) {
          if (['ArrowRight', 'Enter', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            onExpand();
            if (event.key === 'Home') onChange(minSidebarWidth);
            if (event.key === 'End') onChange(maxWidth);
          }
          return;
        }
        const increment = event.shiftKey ? 40 : 10;
        const next =
          event.key === 'ArrowLeft'
            ? width - increment
            : event.key === 'ArrowRight'
              ? width + increment
              : event.key === 'Home'
                ? minSidebarWidth
                : event.key === 'End'
                  ? maxWidth
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        if (next < minSidebarWidth) onCollapse();
        else onChange(next);
      }}
    />
  );
}
