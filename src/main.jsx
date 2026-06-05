import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { CircuitProvider } from './contexts/CircuitContext.jsx';
import CircuitScope from './CircuitScope.jsx';
import './main.css';

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <CircuitProvider>
      <CircuitScope />
    </CircuitProvider>
  </ThemeProvider>
);
