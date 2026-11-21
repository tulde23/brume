import { useEffect, useState, type ReactNode } from 'react';

import { loadBoard, type Board } from './lib/api';
import { teamAbbr, teamColor } from './lib/team';

/** The Viewfinder mark: corner brackets framing three lines of mist (src/ui/Logo.tsx). */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" focusable="false">
      <g className="mark-b" fill="none" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 22 L6 6 L22 6" />
        <path d="M50 6 L66 6 L66 22" />
        <path d="M6 50 L6 66 L22 66" />
        <path d="M66 50 L66 66 L50 66" />
      </g>
      <g className="mark-l" strokeWidth={6} strokeLinecap="round">
        <path d="M20 28 L52 28" />
        <path d="M16 38 L56 38" opacity={0.65} />
        <path d="M24 48 L46 48" opacity={0.4} />
      </g>
    </svg>
  );
}

/** A team's round badge: its initials on its colour. */
export function TeamBadge({ name, size = 26, inverted }: { name: string; size?: number; inverted?: boolean }) {
  const color = teamColor(name);
  const abbr = teamAbbr(name);
  return (
    <span
      className="badge"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: inverted ? '#FFFFFF' : color,
        color: inverted ? color : '#FFFFFF',
        fontSize: Math.round(size * (abbr.length > 2 ? 0.32 : 0.38)),
      }}>
      {abbr}
    </span>
  );
}

export function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="card notice">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export type BoardState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; board: Board };

export function useBoard(season: string | null): [BoardState, () => void] {
  const [state, setState] = useState<BoardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => (s.status === 'ready' && s.board.season === season ? s : { status: 'loading' }));
    loadBoard(season).then(
      (board) => live && setState({ status: 'ready', board }),
      (e: unknown) => live && setState({ status: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' }),
    );
    return () => {
      live = false;
    };
  }, [season, attempt]);
  return [state, () => setAttempt((n) => n + 1)];
}

export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      Loading scores…
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice title="Couldn't load the scoreboard">
      <p className="muted">{message}</p>
      <button type="button" className="button" onClick={onRetry}>
        Try again
      </button>
    </Notice>
  );
}

export function EmptyBoard({ season }: { season: string }) {
  return (
    <Notice title="No results yet">
      <p className="muted">
        {`Nothing has been reported for ${season} so far. Scores appear here once scorekeepers using InkStat report a final.`}
      </p>
    </Notice>
  );
}

/** Underlined tabs on a dark or coloured header, as on a sports app's league and team pages. */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
}: {
  tabs: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  idPrefix: string;
}) {
  const move = (dir: number) => {
    const i = tabs.findIndex((t) => t.key === value);
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    onChange(next.key);
    document.getElementById(`${idPrefix}-tab-${next.key}`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          id={`${idPrefix}-tab-${t.key}`}
          type="button"
          role="tab"
          aria-selected={t.key === value}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={t.key === value ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') move(1);
            else if (e.key === 'ArrowLeft') move(-1);
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
