import { useEffect } from 'react';

import { Link, useRouter, withSeason } from './lib/router';
import { THEME_LABEL, useTheme, type ThemePref } from './lib/theme';
import { Scores } from './pages/Scores';
import { Standings } from './pages/Standings';
import { TeamPage } from './pages/Team';
import { EmptyBoard, LoadError, Loading, LogoMark, Notice, useBoard } from './ui';

type Page = { kind: 'standings' } | { kind: 'scores' } | { kind: 'team'; id: string } | { kind: 'missing' };

function route(path: string): Page {
  if (path === '/' || path === '/standings') return { kind: 'standings' };
  if (path === '/scores') return { kind: 'scores' };
  const team = path.match(/^\/team\/([A-Za-z0-9-]{1,64})$/);
  if (team) return { kind: 'team', id: team[1] };
  return { kind: 'missing' };
}

export function App() {
  const { path, search, navigate } = useRouter();
  const asked = search.get('season');
  const season = asked && /^\d{4}-\d{2}$/.test(asked) ? asked : null;
  const [state, retry] = useBoard(season);
  const [theme, nextTheme] = useTheme();
  const page = route(path);
  const board = state.status === 'ready' ? state.board : null;
  const shown = board?.season ?? season;

  useEffect(() => {
    if (page.kind === 'standings') document.title = 'InkStat · Basketball standings';
    else if (page.kind === 'scores') document.title = 'InkStat · Basketball scores';
  }, [page.kind]);

  const seasons = board?.seasons ?? [];
  const nav = [
    { to: '/', label: 'Standings', on: page.kind === 'standings' },
    { to: '/scores', label: 'Scores', on: page.kind === 'scores' },
  ];

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="wrap bar">
          <Link to={withSeason('/', season)} className="brand" aria-label="InkStat home">
            <span className="logo-chip">
              <LogoMark size={22} />
            </span>
            <span className="brand-text">
              <span className="wordmark" aria-hidden="true">
                Ink<span>Stat</span>
              </span>
              <span className="brand-sub">{`Basketball${shown ? ` · ${shown}` : ''}`}</span>
            </span>
          </Link>
          <div className="bar-tools">
            {seasons.length > 1 && (
              <label className="season">
                <span className="visually-hidden">Season</span>
                <select
                  value={shown ?? ''}
                  onChange={(e) => {
                    const next = new URLSearchParams(search);
                    next.set('season', e.target.value);
                    navigate(`${path}?${next.toString()}`);
                  }}>
                  {seasons.map((s) => (
                    <option key={s.season} value={s.season}>
                      {s.season}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ThemeButton pref={theme} onClick={nextTheme} />
          </div>
        </div>
        <nav className="wrap nav" aria-label="Sections">
          {nav.map((n) => (
            <Link key={n.to} to={withSeason(n.to, season)} className="nav-link" aria-current={n.on ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main" className="wrap main" tabIndex={-1}>
        {page.kind === 'missing' ? (
          <Notice title="Page not found">
            <p>
              <Link to="/">Back to the standings</Link>
            </p>
          </Notice>
        ) : state.status === 'loading' ? (
          <Loading />
        ) : state.status === 'error' ? (
          <LoadError message={state.message} onRetry={retry} />
        ) : page.kind === 'team' ? (
          <TeamPage board={state.board} id={page.id} season={season} />
        ) : state.board.results.length === 0 ? (
          <EmptyBoard season={state.board.season} />
        ) : page.kind === 'scores' ? (
          <Scores board={state.board} season={season} />
        ) : (
          <Standings board={state.board} season={season} />
        )}
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <p>
            <strong>InkStat</strong> reads handwritten basketball scoresheets on your phone and keeps the book for you: box
            scores, standings and season stats, from a photo of the page.
          </p>
          <p className="muted">
            Scores here are reported by scorekeepers using the app, and are final once two of them agree. This site shows team
            names, dates and scores only, never players.
          </p>
        </div>
      </footer>
    </>
  );
}

function ThemeButton({ pref, onClick }: { pref: ThemePref; onClick: () => void }) {
  return (
    <button type="button" className="icon-button" onClick={onClick} aria-label={`Appearance: ${THEME_LABEL[pref]}. Change`} title={`Appearance: ${THEME_LABEL[pref]}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {pref === 'light' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : pref === 'dark' ? (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        ) : (
          <>
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </>
        )}
      </svg>
      <span className="icon-label">{THEME_LABEL[pref]}</span>
    </button>
  );
}
