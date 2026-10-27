import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, rememberSession, setCsrfToken } from '../lib/api';
const Context = createContext(null);
function announce() {
  try {
    localStorage.setItem('dg-auth-change', Date.now() + ':' + Math.random());
  } catch {}
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const data = await api('/api/auth/session');
    setCsrfToken(data.csrf_token);
    setUser(data.user);
    return data.user;
  }, []);
  useEffect(() => {
    let live = true;
    refresh()
      .catch((error) => {
        if (live) setError(error.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    const expired = () => {
      rememberSession(null);
      setCsrfToken('');
      setUser(null);
      setError('Your login has expired. Log in again.');
    };
    const changed = (event) => {
      if (event.key === 'dg-auth-change') refresh().catch(() => {});
    };
    window.addEventListener('genie-auth-expired', expired);
    window.addEventListener('storage', changed);
    try {
      localStorage.removeItem('data-genie-user');
    } catch {}
    return () => {
      live = false;
      window.removeEventListener('genie-auth-expired', expired);
      window.removeEventListener('storage', changed);
    };
  }, [refresh]);
  const authenticate = useCallback(async (mode, body) => {
    const data = await api('/api/auth/' + mode, { method: 'POST', body });
    rememberSession(null);
    setCsrfToken(data.csrf_token);
    setUser(data.user);
    setError('');
    announce();
    return data.user;
  }, []);
  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    rememberSession(null);
    setCsrfToken('');
    setUser(null);
    setError('');
    announce();
  }, []);
  const changePassword = useCallback(async (body) => {
    const data = await api('/api/auth/password', { method: 'POST', body });
    setCsrfToken(data.csrf_token);
    announce();
    return data.message;
  }, []);
  return (
    <Context.Provider
      value={{ user, loading, error, authenticate, logout, changePassword, refresh }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
