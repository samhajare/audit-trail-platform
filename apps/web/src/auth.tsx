import { ReactNode, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { setTokenGetter } from './api';

export function Auth0Gate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, loginWithRedirect, getAccessTokenSilently } = useAuth0();
  setTokenGetter(() => getAccessTokenSilently()); // set during render so child queries always see it
  useEffect(() => { if (!isLoading && !isAuthenticated) void loginWithRedirect(); }, [isLoading, isAuthenticated, loginWithRedirect]);
  return isAuthenticated ? <>{children}</> : <p className="muted pad">Signing in…</p>;
}
