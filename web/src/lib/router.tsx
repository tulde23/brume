import { createContext, useCallback, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

/** Three routes need no router library: the History API and one context. */
interface Location {
  path: string;
  search: URLSearchParams;
}
interface RouterValue extends Location {
  navigate: (to: string) => void;
}

const read = (): Location => ({ path: window.location.pathname.replace(/\/+$/, '') || '/', search: new URLSearchParams(window.location.search) });
const Ctx = createContext<RouterValue | null>(null);

export function Router({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const onPop = () => setLoc(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname + window.location.search) return;
    window.history.pushState(null, '', to);
    setLoc(read());
    window.scrollTo(0, 0);
  }, []);
  return <Ctx.Provider value={{ ...loc, navigate }}>{children}</Ctx.Provider>;
}

export function useRouter(): RouterValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRouter outside Router');
  return v;
}

/** A real link (open in new tab works) that navigates in place on a plain click. */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={click} {...rest} />;
}

/** Keeps the chosen season on every link. */
export const withSeason = (path: string, season: string | null) => (season ? `${path}?season=${encodeURIComponent(season)}` : path);
