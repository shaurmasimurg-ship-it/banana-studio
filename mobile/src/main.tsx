import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { consumeAccess } from './lib/auth.ts';
import App from './App.tsx';
import FreeStudio from './components/FreeStudio.tsx';
import './styles.css';

// Consume private capabilities before rendering any provider content. The public
// tools route never mounts App, so it cannot load a workspace or call a paid API.
const initialAccess = consumeAccess(window);
const showFreeStudio = /^\/free\/?$/.test(window.location.pathname);
if (showFreeStudio) document.title = 'Ücretsiz Video Araçları — Resul Studio';
createRoot(document.getElementById('root')!).render(
  <StrictMode>{showFreeStudio
    ? <FreeStudio onOpenPrivate={() => window.location.assign('/')} />
    : <App initialAccess={initialAccess} />}</StrictMode>,
);
