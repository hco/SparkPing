import { useState, useEffect, useCallback } from 'react';

// Define the shape of all user preferences
export interface UserPreferences {
  // Chart display options
  showMedianLine: boolean;
  showMinLine: boolean;
  showMaxLine: boolean;
  showAvgLine: boolean;
  showSmokeBars: boolean;
  showPacketLoss: boolean;
}

// Default values for all preferences
const defaultPreferences: UserPreferences = {
  showMedianLine: false,
  showMinLine: false,
  showMaxLine: false,
  showAvgLine: false,
  showSmokeBars: true,
  showPacketLoss: true,
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

/**
 * Hook for a single preference value (lighter weight for components that only need one)
 */
export function usePreference<K extends keyof UserPreferences>(key: K): [
  UserPreferences[K],
  (value: UserPreferences[K]) => void
] {
  const { preferences, setPreference } = useUserPreferences();
  
  const setValue = useCallback((value: UserPreferences[K]) => {
    setPreference(key, value);
  }, [key, setPreference]);

  return [preferences[key], setValue];
}



