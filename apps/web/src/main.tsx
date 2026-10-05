import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import { asyncWithLDProvider } from 'launchdarkly-react-client-sdk';
import { store } from './store';
import { Auth0Gate } from './auth';
import App from './App';
import './styles.css';

const env = import.meta.env;
(async () => {
  const LD: React.ComponentType<{ children?: React.ReactNode }> = env.VITE_LD_CLIENT_ID
    ? ((await asyncWithLDProvider({ clientSideID: env.VITE_LD_CLIENT_ID, context: { kind: 'user', key: 'anonymous' } })) as React.ComponentType<{ children?: React.ReactNode }>)
    : ({ children }: { children?: React.ReactNode }) => <>{children}</>;

  let tree = <Provider store={store}><BrowserRouter><App /></BrowserRouter></Provider>;
  if (env.VITE_AUTH_DISABLED !== 'true') {
    tree = (
      <Auth0Provider domain={env.VITE_AUTH0_DOMAIN} clientId={env.VITE_AUTH0_CLIENT_ID}
        authorizationParams={{ redirect_uri: window.location.origin, audience: env.VITE_AUTH0_AUDIENCE }}>
        <Auth0Gate>{tree}</Auth0Gate>
      </Auth0Provider>
    );
  }
  createRoot(document.getElementById('root')!).render(<LD>{tree}</LD>);
})();
