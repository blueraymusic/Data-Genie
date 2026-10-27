import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
const Context = createContext(null);
function savedPreference() {
  try {
    const saved = localStorage.getItem('dg-theme');
    return ['light', 'dark', 'system'].includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}
export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(savedPreference),
    [system, setSystem] = useState(() =>
      matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light',
    );
  const theme = preference === 'system' ? system : preference;
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme:dark)');
    const paint = () => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener('change', paint);
    return () => media.removeEventListener('change', paint);
  }, []);
  useLayoutEffect(() => {
    if (preference === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('dg-theme', preference);
    } catch {}
  }, [theme, preference]);
  return (
    <Context.Provider
      value={{ theme, toggle: () => setPreference(theme === 'dark' ? 'light' : 'dark') }}
    >
      {children}
    </Context.Provider>
  );
}
export const useTheme = () => useContext(Context);
