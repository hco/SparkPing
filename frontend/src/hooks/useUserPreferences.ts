import { useState, useEffect, useCallback } from 'react';
import type { SmokeBarStyle } from '../components/charts/smoke-chart/types';

// Define the shape of all user preferences
export interface UserPreferences {
  // Chart display options
  showMedianLine: boolean;
  showMinLine: boolean;
  showMaxLine: boolean;
  showAvgLine: boolean;
  showSmokeBars: boolean;
  showPacketLoss: boolean;
  showStatsPanel: boolean;
  clipToP99: boolean;
  smokeBarStyle: SmokeBarStyle;
}

// Valid smoke bar styles for validation
const validSmokeBarStyles: SmokeBarStyle[] = ['classic', 'gradient', 'percentile', 'histogram'];

// Default values for all preferences
const defaultPreferences: UserPreferences = {
  showMedianLine: false,
  showMinLine: false,
  showMaxLine: false,
  showAvgLine: false,
  showSmokeBars: true,
  showPacketLoss: true,
  showStatsPanel: false,
  clipToP99: false,
  smokeBarStyle: 'classic',
};

const STORAGE_KEY = 'sparkping-user-preferences';

/**
 * Load preferences from local storage with validation
 */
function loadPreferences(): UserPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultPreferences;

    const parsed = JSON.parse(stored);
    
    // Validate and merge with defaults (handles missing keys from schema updates)
    return {
      showMedianLine: typeof parsed.showMedianLine === 'boolean' 
        ? parsed.showMedianLine 
        : defaultPreferences.showMedianLine,
      showMinLine: typeof parsed.showMinLine === 'boolean'
        ? parsed.showMinLine
        : defaultPreferences.showMinLine,
      showMaxLine: typeof parsed.showMaxLine === 'boolean'
        ? parsed.showMaxLine
        : defaultPreferences.showMaxLine,
      showAvgLine: typeof parsed.showAvgLine === 'boolean'
        ? parsed.showAvgLine
        : defaultPreferences.showAvgLine,
      showSmokeBars: typeof parsed.showSmokeBars === 'boolean'
        ? parsed.showSmokeBars
        : defaultPreferences.showSmokeBars,
      showPacketLoss: typeof parsed.showPacketLoss === 'boolean'
        ? parsed.showPacketLoss
        : defaultPreferences.showPacketLoss,
      showStatsPanel: typeof parsed.showStatsPanel === 'boolean'
        ? parsed.showStatsPanel
        : defaultPreferences.showStatsPanel,
      clipToP99: typeof parsed.clipToP99 === 'boolean'
        ? parsed.clipToP99
        : defaultPreferences.clipToP99,
      smokeBarStyle: validSmokeBarStyles.includes(parsed.smokeBarStyle)
        ? parsed.smokeBarStyle
        : defaultPreferences.smokeBarStyle,
    };
  } catch {
    return defaultPreferences;
  }
}

/**
 * Save preferences to local storage
 */
function savePreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors (e.g., quota exceeded, private browsing)
  }
}

/**
 * Type-safe hook for managing user preferences with local storage persistence
 */
export function useUserPreferences() {
  const [preferences, setPreferencesState] = useState<UserPreferences>(loadPreferences);

  // Sync with local storage when preferences change
  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  // Listen for storage changes from other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const newPrefs = JSON.parse(e.newValue);
          setPreferencesState(prev => ({
            ...prev,
            ...newPrefs,
          }));
        } catch {
          // Ignore parse errors
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  /**
   * Update a single preference
   */
  const setPreference = useCallback(<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    setPreferencesState(prev => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  /**
   * Update multiple preferences at once
   */
  const setPreferences = useCallback((updates: Partial<UserPreferences>) => {
    setPreferencesState(prev => ({
      ...prev,
      ...updates,
    }));
  }, []);

  /**
   * Reset all preferences to defaults
   */
  const resetPreferences = useCallback(() => {
    setPreferencesState(defaultPreferences);
  }, []);

  return {
    preferences,
    setPreference,
    setPreferences,
    resetPreferences,
  };
}
