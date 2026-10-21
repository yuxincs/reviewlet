import { useState, type FormEvent } from 'react';
import type { Finding, FindingStatus } from '../types/review';
import { Icon } from './Icon';

export function FindingCard({
  finding,
  busy,
  onStatus,
  onDiscuss,
  onLine,
  canJump,
}: {
  finding: Finding;
  busy: boolean;
  onStatus: (status: FindingStatus) => void;
  onDiscuss: (message: string) => Promise<boolean>;
  onLine: () => void;
  canJump: boolean;
}) {
  const [discussion, setDiscussion] = useState(false);
  const [message, setMessage] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onDiscuss(message)) setMessage('');
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(finding.suggestedCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <article
      className={`finding-card finding-${finding.status}`}
      aria-label={finding.title}
    >
      <div className="finding-topline">
        <span className={`severity severity-${finding.severity}`}>
          <span />
          {finding.severity === 'high'
            ? 'High priority'
            : finding.severity === 'medium'
              ? 'Medium priority'
              : 'Suggestion'}
        </span>
      </div>
      <h3 className="finding-title">{finding.title}</h3>
      <button className="line-reference" onClick={onLine} disabled={!canJump}>
        <Icon name="code" size={13} /> Line {finding.lineStart}
        {finding.lineEnd !== finding.lineStart ? `–${finding.lineEnd}` : ''}
      </button>
      <div className="finding-body">
        <p>{finding.description}</p>
        <div className="suggestion">
          <p>{finding.suggestion}</p>
        </div>
        <button
          className="text-button suggested-code-toggle"
          onClick={() => setShowCode(!showCode)}
          aria-expanded={showCode}
        >
          <Icon name="code" size={14} />
          {showCode ? 'Hide suggested change' : 'View suggested change'}
          <Icon
            name="chevron"
            size={12}
            className={showCode ? 'rotate-down' : ''}
          />
        </button>
        {showCode && (
          <div className="suggested-code">
            <button
              className="copy-button"
              onClick={() => {
                void copyCode();
              }}
              aria-label="Copy suggested code"
            >
              <Icon name={copied ? 'check' : 'copy'} size={14} />
              {copied ? 'Copied' : 'Copy'}
            </button>
            <pre>{finding.suggestedCode}</pre>
          </div>
        )}
      </div>
      <div className="finding-actions">
        {finding.status === 'open' ? (
          <>
            <button
              className="accept-button"
              disabled={busy}
              onClick={() => onStatus('accepted')}
            >
              <Icon name="check" size={15} />
              Accept
            </button>
            <button
              className="dismiss-button"
              disabled={busy}
              onClick={() => onStatus('dismissed')}
            >
              <Icon name="close" size={14} />
              Dismiss
            </button>
          </>
        ) : (
          <>
            <span className={`resolved-label ${finding.status}`}>
              <Icon
                name={finding.status === 'accepted' ? 'check' : 'close'}
                size={15}
              />
              {finding.status === 'accepted' ? 'Accepted' : 'Dismissed'}
            </span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => onStatus('open')}
            >
              Undo
            </button>
          </>
        )}
        <button
          className={`discuss-button ${discussion ? 'is-active' : ''}`}
          onClick={() => setDiscussion(!discussion)}
          aria-expanded={discussion}
        >
          <Icon name="message" size={14} />
          Discuss
          {finding.comments.length > 0 && (
            <span className="comment-count">{finding.comments.length}</span>
          )}
        </button>
      </div>
      {discussion && (
        <div className="discussion-panel">
          <div className="discussion-heading">
            <Icon name="message" size={14} />
            Finding discussion<span>Mock replies</span>
          </div>
          {finding.comments.length === 0 && (
            <p className="discussion-empty">
              Ask for context, explore a tradeoff, or talk through a fix.
            </p>
          )}
          <div className="comments" aria-live="polite">
            {finding.comments.map((comment) => (
              <div
                key={comment.id}
                className={`comment comment-${comment.author}`}
              >
                <div className="comment-author">
                  {comment.author === 'you' ? (
                    <span className="comment-avatar">Y</span>
                  ) : (
                    <Icon name="sparkle" size={16} />
                  )}
                  {comment.author === 'you' ? 'You' : 'Demo reviewer'}
                </div>
                <p>{comment.body}</p>
              </div>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            className="discussion-form"
          >
            <label className="sr-only" htmlFor={`message-${finding.id}`}>
              Message about {finding.title}
            </label>
            <textarea
              id={`message-${finding.id}`}
              placeholder="Ask about this finding…"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              rows={2}
              disabled={busy}
            />
            <button
              aria-label="Send message"
              type="submit"
              disabled={busy || !message.trim()}
            >
              <Icon name="send" size={16} />
            </button>
          </form>
        </div>
      )}
    </article>
  );
}
