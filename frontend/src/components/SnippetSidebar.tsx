import { languageLabels } from '../languages';
import type { Review } from '../types/review';
import { Icon } from './Icon';

export function SnippetSidebar({
  reviews,
  activeId,
  reviewingId,
  collapsed,
  busy,
  loading,
  onSelect,
  onNew,
  onDelete,
  onCollapse,
  onToggle,
}: {
  reviews: Review[];
  activeId?: string;
  reviewingId?: string;
  collapsed: boolean;
  busy: boolean;
  loading: boolean;
  onSelect: (review: Review) => void;
  onNew: () => void;
  onDelete: (review: Review) => void;
  onCollapse: () => void;
  onToggle: () => void;
}) {
  return (
    <aside
      id="snippet-sidebar"
      className="snippet-sidebar"
      aria-label="Snippet library"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCollapse();
      }}
    >
      <div className="sidebar-brand-row">
        <a
          className="brand"
          href="#workspace"
          aria-label="Reviewlet"
          aria-hidden={collapsed || undefined}
          tabIndex={collapsed ? -1 : undefined}
        >
          <span className="brand-mark">
            <Icon name="code" size={23} />
          </span>
          <span className="sidebar-text brand-word">
            reviewlet<span>.</span>
          </span>
        </a>
        <button
          className="sidebar-toggle"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          aria-controls="snippet-sidebar"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'panelOpen' : 'panelClose'} size={19} />
        </button>
      </div>
      <div className="sidebar-content">
        <button
          className="sidebar-new"
          onClick={onNew}
          disabled={busy}
          aria-label="New snippet"
          title={collapsed ? 'New snippet' : undefined}
        >
          <Icon name="plus" size={17} />
          <span className="sidebar-text">New snippet</span>
        </button>
        <div className="snippet-list-heading">
          <h2 className="sidebar-text">Your snippets</h2>
          <span className="sidebar-text">{reviews.length}</span>
        </div>
        <nav aria-label="Your snippets" className="snippet-library">
          <ul>
            {reviews.map((review) => (
              <li
                key={review.id}
                className={`snippet-row ${reviewingId === review.id ? 'snippet-reviewing' : ''}`}
              >
                <button
                  onClick={() => onSelect(review)}
                  disabled={busy}
                  aria-label={review.title}
                  aria-busy={reviewingId === review.id}
                  aria-current={activeId === review.id ? 'page' : undefined}
                  title={collapsed ? review.title : undefined}
                  className={`snippet-item ${activeId === review.id ? 'selected' : ''}`}
                >
                  {reviewingId === review.id && (
                    <span className="review-border" aria-hidden="true">
                      <svg width="100%" height="100%">
                        <rect x="1" y="1" rx="5" pathLength="100" />
                      </svg>
                    </span>
                  )}
                  <Icon
                    name={reviewingId === review.id ? 'spinner' : 'file'}
                    size={17}
                    className={
                      reviewingId === review.id ? 'review-spinner' : ''
                    }
                  />
                  <span className="sidebar-text snippet-item-text">
                    <span>{review.title}</span>
                    <small>
                      {reviewingId === review.id
                        ? 'Reviewing…'
                        : languageLabels[review.language]}
                    </small>
                  </span>
                </button>
                <button
                  className="snippet-delete"
                  type="button"
                  onClick={() => onDelete(review)}
                  disabled={busy}
                  aria-label={`Delete ${review.title}`}
                  title="Delete snippet"
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
          {loading && (
            <p className="sidebar-text sidebar-empty">Loading snippets…</p>
          )}
          {!loading && reviews.length === 0 && (
            <p className="sidebar-text sidebar-empty">
              Your saved snippets will appear here.
            </p>
          )}
        </nav>
      </div>
      <div
        className="sidebar-footer"
        title="Personal snippets saved in this browser"
      >
        <Icon name="shield" size={15} />
        <span className="sidebar-text">Personal snippets · This browser</span>
      </div>
    </aside>
  );
}
