import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/dm-sans';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
