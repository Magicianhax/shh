import { useCallback, useEffect, useState } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * A hash router in thirty lines. The app has four routes and no nested layouts,
 * so `react-router-dom` would be a dependency for a `switch` statement. Hash
 * routing also means the built `dist/` works from any static host without a
 * rewrite rule.
 */

export type Route = "/" | "/chat" | "/jobs" | "/provider";

const ROUTES: Route[] = ["/", "/chat", "/jobs", "/provider"];

const read = (): Route => {
  const path = window.location.hash.replace(/^#/, "") || "/";
  return (ROUTES.find((r) => r === path) ?? "/") as Route;
};

export function navigate(to: Route) {
  if (window.location.hash !== `#${to}`) window.location.hash = to;
  else window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const onHash = () => {
      setRoute(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return route;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: Route;
  children: ReactNode;
};

export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const handle = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      e.preventDefault();
      navigate(to);
    },
    [to, onClick],
  );

  return (
    <a href={`#${to}`} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
