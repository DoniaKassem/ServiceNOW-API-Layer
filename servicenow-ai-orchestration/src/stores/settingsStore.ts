import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettings } from '../types';

interface SettingsState {
  settings: AppSettings;
  updateServiceNowSettings: (settings: Partial<AppSettings['servicenow']>) => void;
  updateOpenAISettings: (settings: Partial<AppSettings['openai']>) => void;
  updateDefaultSettings: (settings: Partial<AppSettings['defaults']>) => void;
  updatePollingSettings: (settings: Partial<AppSettings['polling']>) => void;
  setConnectionStatus: (isConnected: boolean) => void;
  resetSettings: () => void;
}

const defaultSettings: AppSettings = {
  servicenow: {
    instanceUrl: 'https://illumindev.service-now.com',
    apiKey: '',
    isConnected: false,
  },
  openai: {
    apiKey: '',
    model: 'gpt-4',
    temperature: 0.3,
    maxTokens: 4096,
  },
  defaults: {
    vendorManager: 'Ahmed Donia',
    contractAdministrator: 'Ahmed Donia',
    approver: 'Ahmed Donia',
    currency: 'USD',
    autoSaveDrafts: true,
  },
  polling: {
    enabled: false,
    interval: 30, // 30 seconds default
    showLastRefreshed: true,
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: defaultSettings,

      updateServiceNowSettings: (newSettings) =>
        set((state) => ({
          settings: {
            ...state.settings,
            servicenow: { ...state.settings.servicenow, ...newSettings },
          },
        })),

      updateOpenAISettings: (newSettings) =>
        set((state) => ({
          settings: {
            ...state.settings,
            openai: { ...state.settings.openai, ...newSettings },
          },
        })),

      updateDefaultSettings: (newSettings) =>
        set((state) => ({
          settings: {
            ...state.settings,
            defaults: { ...state.settings.defaults, ...newSettings },
          },
        })),

      updatePollingSettings: (newSettings) =>
        set((state) => ({
          settings: {
            ...state.settings,
            polling: { ...state.settings.polling, ...newSettings },
          },
        })),

      setConnectionStatus: (isConnected) =>
        set((state) => ({
          settings: {
            ...state.settings,
            servicenow: { ...state.settings.servicenow, isConnected },
          },
        })),

      resetSettings: () => set({ settings: defaultSettings }),
    }),
    {
      name: 'servicenow-ai-settings',
      // Persist all settings including API keys
      // Note: API keys are stored in localStorage - ensure this is acceptable for your security requirements
    }
  )
);
