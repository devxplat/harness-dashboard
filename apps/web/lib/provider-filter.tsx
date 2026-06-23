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
  toggle: (id: ProviderId) => void;
  setSelected: (ids: ProviderId[]) => void;
  reset: () => void;
};

const Ctx = createContext<ProviderFilterContext | null>(null);

const fallbackContext: ProviderFilterContext = {
  selected: [...PROVIDER_IDS],
  available: [...PROVIDER_IDS],
  queryProviders: [],
  settingsLoaded: true,
  hasAvailableProviders: true,
  toggle: () => {},
  setSelected: () => {},
  reset: () => {},
};

export function ProviderFilterProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelectedState] = useState<ProviderId[]>([]);
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
        return [...available];
      }
      const next = current.filter((id) => available.includes(id));
      return next;
    });
  }, [available, settings?.providers]);

  const value = useMemo<ProviderFilterContext>(() => {
    const setSelected = (ids: ProviderId[]) => {
      const next = available.filter((id) => ids.includes(id));
      setSelectedState(next);
    };
    const queryProviders = settingsLoaded && selected.length > 0 ? selected : ["__none"];
    return {
      selected,
      available,
      queryProviders,
      settingsLoaded,
      hasAvailableProviders: available.length > 0,
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
  }, [available, selected, settingsLoaded]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProviderFilter() {
  const ctx = useContext(Ctx);
  return ctx ?? fallbackContext;
}
