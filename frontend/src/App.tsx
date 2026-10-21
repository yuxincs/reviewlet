import { useEffect, useRef, useState } from 'react';
import { reviewApi } from './api/mock';
import { CodeEditor } from './components/CodeEditor';
import { Icon } from './components/Icon';
import { SnippetSidebar } from './components/SnippetSidebar';
import { ThemeToggle } from './components/ThemeToggle';
import { WelcomePage } from './components/WelcomePage';
import type { Review, ReviewApi } from './types/review';
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
  const busy = loading || deletingId !== undefined;
  const activeSnippet = snippets.find((snippet) => snippet.id === activeId);

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
    const updated = { ...activeSnippet, ...patch };
    setSnippets((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
    return updated;
  }
  function selectSnippet(snippet: Review) {
    persist(activeSnippet);
    closeMobileSidebar();
    setActiveId(snippet.id);
    setError('');
  }
  function newSnippet() {
    persist(activeSnippet);
    closeMobileSidebar();
    const snippet: Review = {
      id: crypto.randomUUID(),
      title: 'Untitled snippet',
      code: '',
      language: 'typescript',
      context: '',
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

  async function deleteSnippet(snippet: Review) {
    if (busy) return;
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
    >
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <SnippetSidebar
        reviews={snippets}
        activeId={activeId}
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
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                </span>
              </>
            ) : (
              <span className="workspace-title">
                {loading ? 'Loading…' : 'Your workspace'}
              </span>
            )}
            <ThemeToggle />
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
          {loading ? (
            <div className="workspace-loading" role="status">
              Loading your snippets…
            </div>
          ) : !activeSnippet ? (
            <WelcomePage onCreate={newSnippet} />
          ) : (
            <CodeEditor
              code={activeSnippet?.code ?? ''}
              language={activeSnippet?.language ?? 'typescript'}
              disabled={busy || !activeSnippet}
              highlightedLine={null}
              onChange={(code) => changeSnippet({ code })}
              onBlur={() => persist(activeSnippet)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
