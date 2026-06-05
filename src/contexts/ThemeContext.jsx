import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { resetStartupSound, playStartupSound, initAudioContext } from '../utils/startupSound.js';
import { darkTheme, lightTheme } from '../constants/theme.js';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  // Check for saved preference or system preference
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('circuitscope-theme');
      if (saved !== null) {
        return saved === 'dark';
      }
      // Default to dark theme (as per requirements)
      return true;
    }
    return true;
  });

  // Save preference to localStorage
  useEffect(() => {
    localStorage.setItem('circuitscope-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // Update CSS variables on document root
  useEffect(() => {
    const root = document.documentElement;
    const theme = isDark ? darkTheme : lightTheme;

    root.style.setProperty('--bg', theme.bg);
    root.style.setProperty('--bg-light', theme.bgLight);
    root.style.setProperty('--bg-lighter', theme.bgLighter);
    root.style.setProperty('--text', theme.text);
    root.style.setProperty('--text-dim', theme.textDim);
    root.style.setProperty('--line', theme.line);
    root.style.setProperty('--line-strong', theme.lineStrong);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--detector', theme.detector);
    root.style.setProperty('--panel', theme.panel);
    root.style.setProperty('--shadow', theme.shadow);

    // Update body background
    document.body.style.background = theme.bg;
  }, [isDark]);

  const toggleTheme = () => {
    initAudioContext();
    resetStartupSound();
    // Play the sound for the theme we're switching TO (opposite of current)
    playStartupSound(!isDark);
    setIsDark(prev => !prev);
  };

  const value = useMemo(() => ({
    isDark,
    toggleTheme,
    C: isDark ? darkTheme : lightTheme,
  }), [isDark]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// Re-export for backwards compatibility during transition
export { darkTheme, lightTheme };
