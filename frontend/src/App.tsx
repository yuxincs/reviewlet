import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { reviewApi } from './api/reviews';
import { createFlowPalette, FlowColorContext } from './flowColors';
import { demoSnippet } from './api/demo';
import { detectLanguage, LANGUAGE_DETECTION_DELAY } from './detectLanguage';
import { languageLabels } from './languages';
import { getFindingOverview, getReviewSteps } from './demoReviewGuide';
import { ReviewPopover, type ReviewAnchor } from './components/ReviewPopover';
import { ReviewGuide } from './components/ReviewGuide';
import { CodeEditor } from './components/CodeEditor';
import { applyCodeEdit, type CodeEdit } from './codeEdits';
import { applyReviewFix } from './reviewRemapping';
import { Icon } from './components/Icon';
import { SnippetSidebar } from './components/SnippetSidebar';
import { WelcomePage } from './components/WelcomePage';
import type { Language, Review, ReviewApi, ReviewInput } from './types/review';
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
  const pendingDetection = useRef<{ id: string; code: string } | undefined>(
    undefined,
  );
  const reviewInFlight = useRef(false);
  const reviewAbort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => reviewAbort.current?.abort(), []);
  const [reviewing, setReviewing] = useState(false);
  const [savingFix, setSavingFix] = useState(false);
  const [reviewNotice, setReviewNotice] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideAnchor, setGuideAnchor] = useState<ReviewAnchor>();
  const [guideStep, setGuideStep] = useState(0);
  const [explanationStep, setExplanationStep] = useState(-1);
  const [fixPreview, setFixPreview] = useState<{
    snippetId: string;
    code: string;
    edit: CodeEdit;
    title: string;
  }>();
  const [undoFix, setUndoFix] = useState<{
    snippetId: string;
    before: Review;
    appliedCode: string;
  }>();
  const busy = loading || deletingId !== undefined || reviewing || savingFix;
  const activeSnippet = snippets.find((snippet) => snippet.id === activeId);
  const guideSteps = activeSnippet ? getReviewSteps(activeSnippet) : [];
  const flowPalette = createFlowPalette(
    guideSteps.flatMap((finding) =>
      finding.steps.flatMap((step) => [
        ...(step.flow?.nodes.filter((node) => node.reference) ?? []),
        ...(step.links?.map((reference) => ({
          label: reference.symbol,
          reference,
        })) ?? []),
      ]),
    ),
  );
  const preview = fixPreview?.snippetId === activeId ? fixPreview : undefined;
  const canUndo = Boolean(
    undoFix &&
    undoFix.snippetId === activeId &&
    undoFix?.appliedCode === activeSnippet?.code &&
    !busy,
  );
  const showGuide =
    guideOpen && guideSteps.length > 0 && !reviewing && !preview;
  const activeFinding = guideSteps[guideStep];
  const activeStep = activeFinding
    ? explanationStep === -1
      ? getFindingOverview(activeFinding)
      : activeFinding.steps[explanationStep]
    : undefined;
  const activeFlow = showGuide ? activeStep?.flow : undefined;
  const selectedLinks = [
    ...new Map(
      [
        ...(activeStep?.links ?? []),
        ...(activeFlow?.nodes.flatMap((node) =>
          node.reference ? [node.reference] : [],
        ) ?? []),
      ].map((link) => [
        `${link.line}:${link.startColumn}:${link.endColumn}`,
        link,
      ]),
    ).values(),
  ];
  const focusedPortionEnd = selectedLinks.length
    ? Math.max(...selectedLinks.map((link) => link.line))
    : (guideSteps[guideStep]?.lineEnd ?? 1);
  function closeGuide() {
    setGuideOpen(false);
    setFixPreview(undefined);
  }
  function previewFix() {
    if (!activeSnippet || !activeFinding?.edit) return;
    if (applyCodeEdit(activeSnippet.code, activeFinding.edit) === undefined) {
      setError(
        'This suggestion no longer matches the code. Review the snippet again.',
      );
      return;
    }
    setFixPreview({
      snippetId: activeSnippet.id,
      code: activeSnippet.code,
      edit: activeFinding.edit,
      title: activeFinding.summary,
    });
  }
  async function applyFix() {
    if (!preview || !activeSnippet || !activeFinding || busy) return;
    const before = activeSnippet;
    const updated =
      before.code === preview.code
        ? applyReviewFix(before, activeFinding.id)
        : undefined;
    if (!updated) {
      setError(
        'This suggestion no longer matches the code. Review the snippet again.',
      );
      closeGuide();
      return;
    }
    closeGuide();
    setGuideStep(0);
    setSavingFix(true);
    setError('');
    setSnippets((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
    try {
      const saved = await api.saveReviewRevision(updated, before.code);
      setSnippets((items) =>
        items.map((item) => (item.id === saved.id ? saved : item)),
      );
      setUndoFix({ snippetId: before.id, before, appliedCode: updated.code });
      setReviewNotice('Fix applied. Remaining findings updated.');
    } catch (reason) {
      setSnippets((items) =>
        items.map((item) => (item.id === before.id ? before : item)),
      );
      setError(
        reason instanceof Error ? reason.message : 'Could not save this fix.',
      );
    } finally {
      setSavingFix(false);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLTextAreaElement>('.code-input')
          ?.focus({ preventScroll: true }),
      );
    }
  }
  async function undoAppliedFix() {
    if (!canUndo || !undoFix || !activeSnippet) return;
    const applied = activeSnippet;
    const undo = undoFix;
    const restored = {
      ...activeSnippet,
      code: undo.before.code,
      findings: undo.before.findings,
      summary: undo.before.summary,
      guideFindings: undo.before.guideFindings,
    };
    closeGuide();
    setGuideStep(0);
    setSavingFix(true);
    setUndoFix(undefined);
    setSnippets((items) =>
      items.map((item) => (item.id === restored.id ? restored : item)),
    );
    try {
      const saved = await api.saveReviewRevision(restored, applied.code);
      setSnippets((items) =>
        items.map((item) => (item.id === saved.id ? saved : item)),
      );
      setReviewNotice('Fix undone. Previous review restored.');
    } catch (reason) {
      setSnippets((items) =>
        items.map((item) => (item.id === applied.id ? applied : item)),
      );
      setUndoFix(undo);
      setError(
        reason instanceof Error ? reason.message : 'Could not undo this fix.',
      );
    } finally {
      setSavingFix(false);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLTextAreaElement>('.code-input')
          ?.focus({ preventScroll: true }),
      );
    }
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
    setExplanationStep(-1);
    setGuideAnchor(anchor);
    setGuideOpen(true);
  }

  async function dismissFinding() {
    if (!activeSnippet || !activeFinding || busy) return;
    setSavingFix(true);
    setError('');
    try {
      const updated = await api.updateFinding(
        activeSnippet.id,
        activeFinding.id,
        'dismissed',
      );
      setSnippets((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      closeGuide();
      setReviewNotice('Finding dismissed.');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not dismiss this finding.',
      );
    } finally {
      setSavingFix(false);
    }
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
    snippet = detectPendingLanguage(snippet);
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

  function detectPendingLanguage(snippet: Review): Review {
    const pending = pendingDetection.current;
    if (snippet.languageMode === 'manual') {
      if (pending?.id === snippet.id) pendingDetection.current = undefined;
      return snippet;
    }
    if (pending?.id !== snippet.id || pending.code !== snippet.code)
      return snippet;
    pendingDetection.current = undefined;
    const language = detectLanguage(snippet.code);
    if (language === snippet.language) return snippet;
    const updated = { ...snippet, language };
    setSnippets((items) =>
      items.map((item) =>
        item.id === updated.id && item.code === updated.code
          ? { ...item, language }
          : item,
      ),
    );
    return updated;
  }

  const detectAfterTyping = useEffectEvent(() => {
    if (busy || !activeSnippet || deletedIds.current.has(activeSnippet.id))
      return;
    const detected = detectPendingLanguage(activeSnippet);
    if (detected.language !== activeSnippet.language) persist(detected);
  });
  useEffect(() => {
    if (!pendingDetection.current) return;
    const timer = setTimeout(
      () => detectAfterTyping(),
      LANGUAGE_DETECTION_DELAY,
    );
    return () => clearTimeout(timer);
  }, [activeId, activeSnippet?.code]);
  function changeSnippet(
    patch: Partial<
      Pick<Review, 'title' | 'code' | 'language' | 'languageMode'>
    >,
  ) {
    if (!activeSnippet) return undefined;
    closeGuide();
    setReviewNotice('');
    const codeChanged =
      (patch.code !== undefined && patch.code !== activeSnippet.code) ||
      (patch.language !== undefined &&
        patch.language !== activeSnippet.language);
    if (codeChanged) setUndoFix(undefined);
    const updated = {
      ...activeSnippet,
      ...patch,
      ...(codeChanged
        ? {
            findings: [],
            summary: '',
            guideFindings: undefined,
            analysis: undefined,
          }
        : {}),
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
      language: 'unknown',
      languageMode: 'auto',
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
    setSnippets((items) => [snippet, ...items]);
    setActiveId(snippet.id);
    setError('');
    persist(snippet);
  }
  function finishRename() {
    if (!activeSnippet) return;
    const title = activeSnippet.title.trim() || 'Untitled snippet';
    persist(changeSnippet({ title }));
  }

  function chooseLanguage(value: Language | 'auto') {
    if (!activeSnippet || busy) return;
    pendingDetection.current = undefined;
    const updated = changeSnippet(
      value === 'auto'
        ? { languageMode: 'auto', language: detectLanguage(activeSnippet.code) }
        : { languageMode: 'manual', language: value },
    );
    persist(updated);
  }

  async function submitReview() {
    if (busy || reviewInFlight.current || !activeSnippet?.code.trim()) return;
    if (preview) return;
    setUndoFix(undefined);
    reviewInFlight.current = true;
    setReviewing(true);
    const controller = new AbortController();
    reviewAbort.current = controller;
    closeGuide();
    setReviewNotice('');
    setError('');
    try {
      const input = {
        ...detectPendingLanguage(activeSnippet),
        title: activeSnippet.title.trim() || 'Untitled snippet',
      };
      await api.saveSnippet(activeSnippet.id, input);
      const reviewed = await api.reviewSnippet(
        activeSnippet.id,
        input,
        controller.signal,
      );
      setSnippets((items) =>
        items.map((item) => (item.id === reviewed.id ? reviewed : item)),
      );
      setGuideStep(0);
      closeGuide();
      const count = reviewed.findings.length;
      setReviewNotice(
        `Review complete: ${count} ${count === 1 ? 'finding' : 'findings'}.`,
      );
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not review your snippet.',
      );
    } finally {
      reviewInFlight.current = false;
      reviewAbort.current = undefined;
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
                <select
                  className="snippet-language-select"
                  aria-label="Snippet language"
                  value={
                    activeSnippet.languageMode === 'manual'
                      ? activeSnippet.language
                      : 'auto'
                  }
                  disabled={busy || Boolean(preview)}
                  onChange={(event) =>
                    chooseLanguage(event.target.value as Language | 'auto')
                  }
                >
                  <option value="auto">Auto</option>
                  {Object.entries(languageLabels)
                    .filter(([value]) => value !== 'unknown')
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <span className="workspace-title">
                {loading ? 'Loading…' : 'Your workspace'}
              </span>
            )}
            <button
              type="button"
              className="primary-button review-snippet-button"
              disabled={busy || Boolean(preview) || !activeSnippet?.code.trim()}
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
              onDemo={() => addSnippet(demoSnippet)}
            />
          ) : (
            <FlowColorContext.Provider value={flowPalette}>
              <div className="review-editor-layout">
                {canUndo && (
                  <div className="fix-applied-notice" role="status">
                    <Icon name="check" size={15} />
                    <span>Fix applied</span>
                    <span className="fix-applied-hint">
                      {guideSteps.length
                        ? `${guideSteps.length} remaining finding${guideSteps.length === 1 ? '' : 's'}`
                        : 'No remaining findings'}
                    </span>
                    <button
                      onClick={() => {
                        void undoAppliedFix();
                      }}
                    >
                      Undo
                    </button>
                  </div>
                )}
                <CodeEditor
                  code={activeSnippet.code}
                  fixPreview={
                    preview
                      ? {
                          edit: preview.edit,
                          title: preview.title,
                          onApply: () => {
                            void applyFix();
                          },
                          onBack: () => setFixPreview(undefined),
                        }
                      : undefined
                  }
                  language={activeSnippet.language}
                  disabled={busy}
                  findings={activeSnippet.findings.filter(
                    (finding) => finding.status === 'open',
                  )}
                  linkedRanges={showGuide ? selectedLinks : []}
                  flowNodes={activeFlow?.nodes}
                  sampleNodes={
                    explanationStep >= 0 ? activeFlow?.nodes : undefined
                  }
                  flowConnections={activeFlow?.connections}
                  reviewFocus={showGuide ? guideSteps[guideStep] : undefined}
                  focusedLine={showGuide ? focusedPortionEnd : undefined}
                  onReviewLine={openLineReview}
                  onDismissReview={closeGuide}
                  onChange={(code) => {
                    if (
                      activeSnippet.code !== code &&
                      activeSnippet.languageMode !== 'manual'
                    )
                      pendingDetection.current = { id: activeSnippet.id, code };
                    changeSnippet({ code });
                  }}
                  onBlur={() => persist(activeSnippet)}
                />
                {!preview && guideAnchor && guideSteps[guideStep] && (
                  <ReviewPopover
                    open={showGuide}
                    anchor={guideAnchor}
                    focusedLine={focusedPortionEnd}
                    onNavigateFinding={(direction) => {
                      const ordered = guideSteps
                        .map((finding, index) => ({ finding, index }))
                        .sort(
                          (a, b) =>
                            a.finding.lineStart - b.finding.lineStart ||
                            a.finding.lineEnd - b.finding.lineEnd,
                        );
                      const current = ordered.findIndex(
                        (item) => item.index === guideStep,
                      );
                      const next =
                        ordered[
                          Math.max(
                            0,
                            Math.min(current + direction, ordered.length - 1),
                          )
                        ].index;
                      if (next === guideStep) return;
                      setGuideStep(next);
                      setExplanationStep(-1);
                    }}
                    onNavigate={(direction) => {
                      setExplanationStep((current) =>
                        Math.max(
                          -1,
                          Math.min(
                            current + direction,
                            guideSteps[guideStep].steps.length - 1,
                          ),
                        ),
                      );
                    }}
                    onClose={closeGuide}
                  >
                    <ReviewGuide
                      finding={guideSteps[guideStep]}
                      activeStep={explanationStep}
                      onPreview={
                        activeFinding?.edit &&
                        activeFinding.state !== 'needs-recheck'
                          ? previewFix
                          : undefined
                      }
                      onStep={(index) => {
                        setExplanationStep(index);
                      }}
                      onClose={closeGuide}
                      onDismiss={() => {
                        void dismissFinding();
                      }}
                    />
                  </ReviewPopover>
                )}
              </div>
            </FlowColorContext.Provider>
          )}
        </main>
      </div>
    </div>
  );
}
