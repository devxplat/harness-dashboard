"use client";

import { useApi } from "@/hooks/use-api";
import { PROVIDER_IDS, type ProviderId } from "@/lib/providers";
import type { SettingsInfo } from "@/lib/types";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

type ProviderFilterContext = {
  selected: ProviderId[];
  available: ProviderId[];
  queryProviders: string[];
  settingsLoaded: boolean;
  hasAvailableProviders: boolean;
  hasSelectedProviders: boolean;
  requiresProviderSelection: boolean;
  toggle: (id: ProviderId) => void;
  setSelected: (ids: ProviderId[]) => void;
  reset: () => void;
};

const Ctx = createContext<ProviderFilterContext | null>(null);
const STORAGE_KEY = "harness.providerFilter.selected";

const fallbackContext: ProviderFilterContext = {
  selected: [...PROVIDER_IDS],
  available: [...PROVIDER_IDS],
  queryProviders: [],
  settingsLoaded: true,
  hasAvailableProviders: true,
  hasSelectedProviders: true,
  requiresProviderSelection: false,
  toggle: () => {},
  setSelected: () => {},
  reset: () => {},
};

export function ProviderFilterProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelectedState] = useState<ProviderId[]>([]);
  const [selectionInitialized, setSelectionInitialized] = useState(false);
  const initialized = useRef(false);
  const { data: settings } = useApi<SettingsInfo>("/api/settings");
  const settingsLoaded = Boolean(settings?.providers);

  const available = useMemo<ProviderId[]>(() => {
    if (!settings?.providers) return [];
    return settings.providers
      .filter((provider) => provider.enabled && provider.discovered)
      .map((provider) => provider.id)
      .filter((id): id is ProviderId => PROVIDER_IDS.includes(id as ProviderId));
  }, [settings]);

  useEffect(() => {
    if (!settings?.providers) return;
    setSelectedState((current) => {
      if (!initialized.current) {
        initialized.current = true;
        setSelectionInitialized(true);
        return readStoredSelection(available) ?? [...available];
      }
      const next = current.filter((id) => available.includes(id));
      return next;
    });
  }, [available, settings?.providers]);

  useEffect(() => {
    if (!settingsLoaded || !selectionInitialized) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch {
      // Ignore storage failures; provider filtering still works for the session.
    }
  }, [selected, selectionInitialized, settingsLoaded]);

  const value = useMemo<ProviderFilterContext>(() => {
    const setSelected = (ids: ProviderId[]) => {
      const next = available.filter((id) => ids.includes(id));
      setSelectedState(next);
    };
    const queryProviders = settingsLoaded && selectionInitialized
      ? selected.length > 0
        ? selected
        : ["__none"]
      : [];
    return {
      selected,
      available,
      queryProviders,
      settingsLoaded,
      hasAvailableProviders: available.length > 0,
      hasSelectedProviders: selected.length > 0,
      requiresProviderSelection:
        settingsLoaded && selectionInitialized && available.length > 0 && selected.length === 0,
      toggle: (id) => {
        if (!available.includes(id)) return;
        setSelectedState((current) => {
          const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
          return next;
        });
      },
      setSelected,
      reset: () => setSelectedState([...available]),
    };
  }, [available, selected, selectionInitialized, settingsLoaded]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProviderFilter() {
  const ctx = useContext(Ctx);
  return ctx ?? fallbackContext;
}

function readStoredSelection(available: ProviderId[]): ProviderId[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return available.filter((id) => parsed.includes(id));
  } catch {
    return null;
  }
}
