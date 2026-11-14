import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '../tokens.css';
import '../styles.css';
import './sheet.css';
import { Sheet } from './Sheet';

// ?density=compact and ?theme=mid|cool set what the app's Appearance settings would; dark follows the system.
const params = new URLSearchParams(location.search);
const density = params.get('density');
const theme = params.get('theme');
if (density === 'compact') document.documentElement.dataset.density = 'compact';
if (theme) document.documentElement.dataset.theme = theme;

createRoot(document.getElementById('root')!).render(<StrictMode><Sheet /></StrictMode>);
