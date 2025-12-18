import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { 
  ThemeContext,
  getSystemTheme,
  loadTheme,
  saveTheme,
  applyTheme,
  type Theme,
  type ThemeContextValue,
} from './theme';

export type { Theme, ResolvedTheme, ThemeContextValue } from './theme';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const [resolvedTheme, setResolvedTheme] = useState(() => {
    const initial = loadTheme();
    return initial === 'system' ? getSystemTheme() : initial;
  });

  // Apply theme on mount and when resolved theme changes
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        const newResolvedTheme = e.matches ? 'dark' : 'light';
        setResolvedTheme(newResolvedTheme);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    saveTheme(newTheme);
    
    const newResolvedTheme = newTheme === 'system' ? getSystemTheme() : newTheme;
    setResolvedTheme(newResolvedTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    // Cycle through: system -> light -> dark -> system
    const nextTheme: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(nextTheme);
  }, [theme, setTheme]);

  const value: ThemeContextValue = {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    isDark: resolvedTheme === 'dark',
    isLight: resolvedTheme === 'light',
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
