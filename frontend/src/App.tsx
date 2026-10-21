import { useEffect, useRef, useState } from 'react';
import { reviewApi } from './api/mock';
import { examples } from './api/examples';
import { getReviewSteps, hasDemoReviewGuide } from './demoReviewGuide';
import { ReviewPopover, type ReviewAnchor } from './components/ReviewPopover';
import { ReviewGuide } from './components/ReviewGuide';
import { CodeEditor } from './components/CodeEditor';
import { Icon } from './components/Icon';
import { SnippetSidebar } from './components/SnippetSidebar';
import { WelcomePage } from './components/WelcomePage';
import type { Review, ReviewApi, ReviewInput } from './types/review';
import './styles.css';

export default function App({ api = reviewApi }: { api?: ReviewApi }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('reviewlet.sidebar-collapsed');
      if (saved !== null) return saved === 'true';
    } catch {
      /* The sidebar still works when storage is disabled. */
    }
    return window.matchMedia?.('(max-width: 700px)')?.matches ?? false;
  });
  const [snippets, setSnippets] = useState<Review[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string>();
  const deletedIds = useRef(new Set<string>());
  const reviewInFlight = useRef(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNotice, setReviewNotice] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideAnchor, setGuideAnchor] = useState<ReviewAnchor>();
  const [guideStep, setGuideStep] = useState(0);
  const [guideLine, setGuideLine] = useState<number>();
  const busy = loading || deletingId !== undefined || reviewing;
  const activeSnippet = snippets.find((snippet) => snippet.id === activeId);
  const guideSteps = activeSnippet ? getReviewSteps(activeSnippet) : [];
  const showGuide = guideOpen && guideSteps.length > 0 && !reviewing;
  function closeGuide() {
    setGuideOpen(false);
  }
  function openLineReview(line: number, anchor: ReviewAnchor) {
    const index = guideSteps.findIndex(
      (step) => line >= step.lineStart && line <= step.lineEnd,
    );
    if (index < 0) {
      closeGuide();
      return;
    }
    setGuideStep(index);
    setGuideLine(undefined);
    setGuideAnchor(anchor);
    setGuideOpen(true);
  }

  useEffect(() => {
    let cancelled = false;
    void api
      .listReviews()
      .then((items) => {
        if (cancelled) return;
        setSnippets(items);
        setActiveId(items[0]?.id);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Could not load your snippets.',
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  function setSidebar(collapsed: boolean) {
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem('reviewlet.sidebar-collapsed', String(collapsed));
    } catch {
      /* Keep the preference for this session only. */
    }
  }
  function closeMobileSidebar() {
    if (window.matchMedia?.('(max-width: 700px)')?.matches) setSidebar(true);
  }
  function persist(snippet: Review | undefined) {
    if (!snippet || deletedIds.current.has(snippet.id)) return;
    void api
      .saveSnippet(snippet.id, {
        ...snippet,
        title: snippet.title.trim() || 'Untitled snippet',
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not save your snippet.',
        );
      });
  }
  function changeSnippet(
    patch: Partial<Pick<Review, 'title' | 'code' | 'language'>>,
  ) {
    if (!activeSnippet) return undefined;
    closeGuide();
    setReviewNotice('');
    const codeChanged =
      (patch.code !== undefined && patch.code !== activeSnippet.code) ||
      (patch.language !== undefined &&
        patch.language !== activeSnippet.language);
    const updated = {
      ...activeSnippet,
      ...patch,
      ...(codeChanged ? { findings: [], summary: '' } : {}),
    };
    setSnippets((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
    return updated;
  }
  function selectSnippet(snippet: Review) {
    setGuideStep(0);
    closeGuide();
    setReviewNotice('');
    persist(activeSnippet);
    closeMobileSidebar();
    setActiveId(snippet.id);
    setError('');
  }
  function newSnippet() {
    addSnippet({
      title: 'Untitled snippet',
      code: '',
      language: 'typescript',
      context: '',
    });
  }
  function addSnippet(input: ReviewInput) {
    closeGuide();
    setReviewNotice('');
    persist(activeSnippet);
    closeMobileSidebar();
    const snippet: Review = {
      ...input,
      id: crypto.randomUUID(),
      summary: '',
      findings: [],
      createdAt: new Date().toISOString(),
    };
    setSnippets((items) => [snippet, ...items].slice(0, 20));
    setActiveId(snippet.id);
    setError('');
    persist(snippet);
  }
  function finishRename() {
    if (!activeSnippet) return;
    const title = activeSnippet.title.trim() || 'Untitled snippet';
    persist(changeSnippet({ title }));
  }

  async function submitReview() {
    if (busy || reviewInFlight.current || !activeSnippet?.code.trim()) return;
    reviewInFlight.current = true;
    setReviewing(true);
    closeGuide();
    setReviewNotice('');
    setError('');
    try {
      const input = {
        ...activeSnippet,
        title: activeSnippet.title.trim() || 'Untitled snippet',
      };
      await api.saveSnippet(activeSnippet.id, input);
      const reviewed = await api.reviewSnippet(activeSnippet.id, input);
      setSnippets((items) =>
        items.map((item) => (item.id === reviewed.id ? reviewed : item)),
      );
      setGuideStep(0);
      closeGuide();
      const count = reviewed.findings.length;
      setReviewNotice(
        `Demo review complete: ${count} ${count === 1 ? 'finding' : 'findings'}.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not review your snippet.',
      );
    } finally {
      reviewInFlight.current = false;
      setReviewing(false);
    }
  }

  async function deleteSnippet(snippet: Review) {
    if (busy) return;
    closeGuide();
    setReviewNotice('');
    setDeletingId(snippet.id);
    deletedIds.current.add(snippet.id);
    setError('');
    try {
      await api.deleteSnippet(snippet.id);
      const index = snippets.findIndex((item) => item.id === snippet.id);
      const remaining = snippets.filter((item) => item.id !== snippet.id);
      setSnippets(remaining);
      if (activeId === snippet.id) {
        setActiveId((remaining[index] ?? remaining[index - 1])?.id);
      }
    } catch (reason) {
      deletedIds.current.delete(snippet.id);
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not delete this snippet.',
      );
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <div
      className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          if (!event.repeat) void submitReview();
        }
      }}
    >
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <SnippetSidebar
        reviews={snippets}
        activeId={activeId}
        reviewingId={reviewing ? activeId : undefined}
        collapsed={sidebarCollapsed}
        busy={busy}
        loading={loading}
        onSelect={selectSnippet}
        onNew={newSnippet}
        onDelete={(snippet) => {
          void deleteSnippet(snippet);
        }}
        onCollapse={() => setSidebar(true)}
        onToggle={() => setSidebar(!sidebarCollapsed)}
      />
      {!sidebarCollapsed && (
        <button
          className="sidebar-backdrop"
          aria-label="Close sidebar"
          onClick={() => setSidebar(true)}
        />
      )}
      <div className="app-main editor-main">
        <header className="app-header">
          <div className="header-inner editor-titlebar">
            {activeSnippet ? (
              <>
                <Icon name="file" size={17} className="titlebar-file-icon" />
                <span
                  className="snippet-name-field"
                  data-value={
                    activeSnippet?.title ||
                    (loading ? 'Loading…' : 'Untitled snippet')
                  }
                >
                  <input
                    aria-label="Snippet name"
                    className="snippet-name-input"
                    value={activeSnippet?.title ?? ''}
                    placeholder={loading ? 'Loading…' : 'Untitled snippet'}
                    maxLength={120}
                    disabled={busy || !activeSnippet}
                    onChange={(event) =>
                      changeSnippet({ title: event.target.value })
                    }
                    onBlur={finishRename}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.metaKey &&
                        !event.ctrlKey
                      )
                        event.currentTarget.blur();
                    }}
                  />
                </span>
              </>
            ) : (
              <span className="workspace-title">
                {loading ? 'Loading…' : 'Your workspace'}
              </span>
            )}
            <button
              type="button"
              className="primary-button review-snippet-button"
              disabled={busy || !activeSnippet?.code.trim()}
              onClick={() => {
                void submitReview();
              }}
              aria-label={reviewing ? 'Reviewing…' : 'Review snippet'}
              aria-busy={reviewing}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              title="Review snippet (⌘Enter / Ctrl+Enter)"
            >
              <Icon
                name={reviewing ? 'spinner' : 'sparkle'}
                size={16}
                className={reviewing ? 'review-spinner' : ''}
              />
              <span>{reviewing ? 'Reviewing…' : 'Review snippet'}</span>
              <kbd aria-hidden="true">⌘↵</kbd>
            </button>
          </div>
        </header>
        <main
          id="workspace"
          className="workspace editor-workspace"
          aria-label={activeSnippet ? 'Code editor' : 'Workspace'}
        >
          {error && (
            <div className="error-banner" role="alert">
              <p>{error}</p>
              <button onClick={() => setError('')} aria-label="Dismiss error">
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {reviewNotice && (
            <div className="sr-only" role="status">
              {reviewNotice}
            </div>
          )}
          {loading ? (
            <div className="workspace-loading" role="status">
              Loading your snippets…
            </div>
          ) : !activeSnippet ? (
            <WelcomePage
              onCreate={newSnippet}
              onDemo={() => addSnippet(examples.database)}
            />
          ) : (
            <div className="review-editor-layout">
              <CodeEditor
                code={activeSnippet.code}
                language={activeSnippet.language}
                disabled={busy}
                findings={activeSnippet.findings}
                linkedRanges={showGuide ? guideSteps[guideStep].ranges : []}
                focusedLine={showGuide ? guideLine : undefined}
                onReviewLine={openLineReview}
                onDismissReview={closeGuide}
                onChange={(code) => changeSnippet({ code })}
                onBlur={() => persist(activeSnippet)}
              />
              {guideAnchor && guideSteps[guideStep] && (
                <ReviewPopover
                  open={showGuide}
                  anchor={guideAnchor}
                  onClose={closeGuide}
                >
                  <ReviewGuide
                    step={guideSteps[guideStep]}
                    isDemo={hasDemoReviewGuide(activeSnippet)}
                    onLine={setGuideLine}
                    onClose={closeGuide}
                  />
                </ReviewPopover>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
