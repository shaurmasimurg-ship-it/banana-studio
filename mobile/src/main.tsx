import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { consumeAccess } from './lib/auth.ts';
import App from './App.tsx';
import './styles.css';

const initialAccess = consumeAccess(window);
createRoot(document.getElementById('root')!).render(
  <StrictMode><App initialAccess={initialAccess} /></StrictMode>,
);
