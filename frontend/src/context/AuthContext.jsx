import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, rememberSession, setCsrfToken } from '../lib/api';
const Context = createContext(null);
function announce() {
  try {
    localStorage.setItem('dg-auth-change', Date.now() + ':' + Math.random());
  } catch {}
}

export function AuthProvider({ children }) {
  const generation = useRef(0),
    account = useRef(null);
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [connectionError, setConnectionError] = useState(false);
  const refresh = useCallback(async () => {
    const revision = ++generation.current;
    try {
      const data = await api('/api/auth/session');
      if (generation.current === revision) {
        if (account.current !== null && account.current !== data.user?.account_id)
          rememberSession(null);
        account.current = data.user?.account_id ?? null;
        setCsrfToken(data.csrf_token);
        setUser(data.user);
        setError('');
        setConnectionError(false);
        if (!data.user) rememberSession(null);
      }
      return data.user;
    } catch (error) {
      if (generation.current === revision) {
        setError(error.message);
        setConnectionError(true);
      }
      throw error;
    }
  }, []);
  useEffect(() => {
    let live = true;
    const revision = generation.current + 1;
    refresh()
      .catch((error) => {
        if (live && generation.current === revision) setError(error.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    const expired = () => {
      generation.current++;
      account.current = null;
      rememberSession(null);
      setCsrfToken('');
      setUser(null);
      setError('Your login has expired. Log in again.');
      setConnectionError(false);
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
    const revision = ++generation.current;
    setError('');
    setConnectionError(false);
    let data;
    try {
      data = await api('/api/auth/' + mode, { method: 'POST', body });
    } catch (error) {
      if (
        generation.current === revision &&
        error.code === 'cloud_storage_unavailable' &&
        error.recovery === 'retry'
      ) {
        setError(error.message);
        setConnectionError(true);
      }
      throw error;
    }
    if (data.verification_required) return data;
    if (generation.current !== revision) return data.user;
    rememberSession(null);
    account.current = data.user.account_id;
    setCsrfToken(data.csrf_token);
    setUser(data.user);
    setError('');
    announce();
    return data.user;
  }, []);
  const logout = useCallback(async () => {
    const revision = ++generation.current;
    await api('/api/auth/logout', { method: 'POST', body: {} });
    if (generation.current !== revision) return;
    rememberSession(null);
    account.current = null;
    setCsrfToken('');
    setUser(null);
    setError('');
    setConnectionError(false);
    announce();
  }, []);
  const changePassword = useCallback(async (body) => {
    const data = await api('/api/auth/password', { method: 'POST', body });
    setCsrfToken(data.csrf_token);
    announce();
    return data.message;
  }, []);
  const updateProfile = useCallback(async (body) => {
    const owner = account.current;
    const data = await api('/api/auth/profile', { method: 'POST', body });
    if (owner !== null && account.current === owner && data.user.account_id === owner) {
      setUser(data.user);
      announce();
    }
    return data.user;
  }, []);
  const deleteAccount = useCallback(async (body) => {
    const owner = account.current;
    const result = await api('/api/auth/delete', { method: 'POST', body });
    if (!result.deleted)
      throw new Error(
        'Account deletion was not confirmed. Please check your account before retrying.',
      );
    if (account.current === owner) {
      generation.current++;
      account.current = null;
      rememberSession(null);
      setCsrfToken('');
      setUser(null);
      setError('');
      setConnectionError(false);
      announce();
    }
    return result;
  }, []);
  return (
    <Context.Provider
      value={{
        user,
        loading,
        error,
        connectionError,
        authenticate,
        logout,
        changePassword,
        updateProfile,
        deleteAccount,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
