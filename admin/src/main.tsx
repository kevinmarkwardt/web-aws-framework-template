import '@yourapp/shared/i18n/admin';  // first: i18next with this site's texts
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './tabs/builtin';
import './tabs/app';
import App from './App';

async function boot() {
  // Dev and test builds: mocked entities are answered in the browser (MSW; packages/shared/src/mocks), the same
  // handlers and fixtures as the user site's. A production bundle doesn't contain the mocks at all.
  if (import.meta.env.VITE_STAGE !== 'prod') {
    const { startMocks } = await import('@yourapp/shared/mocks');
    await startMocks().catch((e) => console.error('[mocks] did not start', e));
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* a language other than English loads before the first render */}
      <Suspense fallback={null}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Suspense>
    </StrictMode>
  );
}

void boot();
