import { createContext, useContext, useEffect, useState, useCallback } from 'react';
const Context = createContext(null);
const currentRoute = () => location.pathname + location.search + location.hash;

export function Router({ children }) {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const changed = () => setRoute(currentRoute());
    window.addEventListener('popstate', changed);
    window.addEventListener('hashchange', changed);
    return () => {
      window.removeEventListener('popstate', changed);
      window.removeEventListener('hashchange', changed);
    };
  }, []);
  const navigate = useCallback((url, replace = false) => {
    history[replace ? 'replaceState' : 'pushState']({}, '', url);
    setRoute(currentRoute());
  }, []);
  useEffect(() => {
    if (location.hash)
      requestAnimationFrame(() => {
        let id;
        try {
          id = decodeURIComponent(location.hash.slice(1));
        } catch {
          id = location.hash.slice(1);
        }
        const target = document.getElementById(id);
        target?.scrollIntoView();
        if (target?.hasAttribute('tabindex')) target.focus({ preventScroll: true });
      });
    else window.scrollTo(0, 0);
  }, [route]);
  return (
    <Context.Provider value={{ route, navigate, pathname: route.split(/[?#]/)[0] }}>
      {children}
    </Context.Provider>
  );
}
export const useRouter = () => useContext(Context);
export function Link({ href, onClick, children, ...props }) {
  const { navigate } = useRouter();
  return (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          href.startsWith('/') &&
          !props.download &&
          props.target !== '_blank'
        ) {
          event.preventDefault();
          navigate(href);
        }
      }}
    >
      {children}
    </a>
  );
}
