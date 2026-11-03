"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  applyTheme,
  getThemeScope,
  getThemeSnapshot,
  getThemeSnapshotServer,
  subscribeTheme,
  writeStoredTheme,
  type ThemeMode,
} from "../../lib/theme";

type ThemeController = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeController | null>(null);

export default function ThemeProvider({ children }: { children: ReactNode }) {
  // localStorage is the source of truth, so switching accounts or another tab
  // updating the preference re-renders without any effect-owned state.
  const mode = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeSnapshotServer);

  // Keeps <html> in step with the snapshot, including React's StrictMode
  // remounts in development, which reset attributes on the document element.
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    writeStoredTheme(next, getThemeScope());
  }, []);

  const value = useMemo<ThemeController>(
    () => ({
      mode,
      setMode,
      toggle: () => setMode(mode === "dark" ? "light" : "dark"),
    }),
    [mode, setMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeController {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}
