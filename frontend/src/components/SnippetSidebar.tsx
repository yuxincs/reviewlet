import { useState } from 'react';
import { getReviewStatus, reviewStatusLabels } from '../reviewStatus';
import { languageLabels } from '../languages';
import type { Review } from '../types/review';
import { Icon } from './Icon';
import { LanguageIcon } from './LanguageIcon';

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
  const [languageFilter, setLanguageFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const filtered = languageFilter !== 'all' || statusFilter !== 'all';
  const visibleReviews = reviews.filter(
    (review) =>
      (languageFilter === 'all' || review.language === languageFilter) &&
      (statusFilter === 'all' ||
        getReviewStatus(review, reviewingId) === statusFilter),
  );
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
          <span className="sidebar-text">
            {filtered
              ? `${visibleReviews.length} / ${reviews.length}`
              : reviews.length}
          </span>
        </div>
        <div className="snippet-filters" hidden={collapsed}>
          <select
            aria-label="Filter by language"
            value={languageFilter}
            onChange={(event) => setLanguageFilter(event.target.value)}
          >
            <option value="all">All languages</option>
            {Object.entries(languageLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by review status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            {Object.entries(reviewStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setLanguageFilter('all');
                setStatusFilter('all');
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        <nav aria-label="Your snippets" className="snippet-library">
          <ul>
            {visibleReviews.map((review) => (
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
                  data-review-status={getReviewStatus(review, reviewingId)}
                  aria-description={
                    reviewStatusLabels[getReviewStatus(review, reviewingId)]
                  }
                  title={`${review.title} · ${reviewStatusLabels[getReviewStatus(review, reviewingId)]}`}
                  className={`snippet-item ${activeId === review.id ? 'selected' : ''}`}
                >
                  {reviewingId === review.id && (
                    <span className="review-border" aria-hidden="true">
                      <svg width="100%" height="100%">
                        <rect x="1" y="1" rx="5" pathLength="100" />
                      </svg>
                    </span>
                  )}
                  {reviewingId === review.id ? (
                    <Icon name="spinner" size={18} className="review-spinner" />
                  ) : (
                    <LanguageIcon language={review.language} />
                  )}
                  <span className="sidebar-text snippet-item-text">
                    <span>{review.title}</span>
                    <small>
                      <span className="snippet-item-status">
                        {languageLabels[review.language]} ·{' '}
                        {
                          reviewStatusLabels[
                            getReviewStatus(review, reviewingId)
                          ]
                        }
                      </span>
                      <time
                        dateTime={review.createdAt}
                        title={new Date(review.createdAt).toLocaleString()}
                      >
                        {new Date(review.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </time>
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
          {!loading && reviews.length > 0 && visibleReviews.length === 0 && (
            <p className="sidebar-text sidebar-empty">
              No snippets match your filters.
            </p>
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
        title="Personal snippets saved in your workspace"
      >
        <Icon name="shield" size={15} />
        <span className="sidebar-text">Personal snippets · Your workspace</span>
      </div>
    </aside>
  );
}
