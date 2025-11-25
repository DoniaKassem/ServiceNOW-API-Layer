import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Settings,
  Server,
  Key,
  CheckCircle,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  Save,
  Zap,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { initServiceNowAPI, resetServiceNowAPI } from '../../services/servicenow';
import { initOpenAIService } from '../../services/openai';
import { ConnectionHealthCheck } from './ConnectionHealthCheck';
import { clsx } from 'clsx';

export function SettingsPanel() {
  const { settings, updateServiceNowSettings, updateOpenAISettings, updateDefaultSettings, updatePollingSettings, setConnectionStatus } =
    useSettingsStore();

  const [showSnApiKey, setShowSnApiKey] = useState(false);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [openaiSaved, setOpenaiSaved] = useState(false);
  const [snSaved, setSnSaved] = useState(false);

  const handleTestConnection = async () => {
    if (!settings.servicenow.instanceUrl || !settings.servicenow.apiKey) {
      setTestResult('error');
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const api = initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
      const isConnected = await api.testConnection();

      setTestResult(isConnected ? 'success' : 'error');
      setConnectionStatus(isConnected);
    } catch {
      setTestResult('error');
      setConnectionStatus(false);
      resetServiceNowAPI();
    } finally {
      setTesting(false);
    }
  };

  const handleSaveServiceNow = () => {
    setSnSaved(true);
    setTimeout(() => setSnSaved(false), 3000);
  };

  const handleSaveOpenAI = () => {
    initOpenAIService(
      settings.openai.apiKey,
      settings.openai.model,
      settings.openai.temperature,
      settings.openai.maxTokens
    );
    setOpenaiSaved(true);
    setTimeout(() => setOpenaiSaved(false), 3000);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-8 h-8 text-gray-700" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500">Configure your connections and defaults</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* ServiceNow Connection */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">ServiceNow Connection</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Instance URL
              </label>
              <input
                type="url"
                value={settings.servicenow.instanceUrl}
                onChange={(e) => updateServiceNowSettings({ instanceUrl: e.target.value })}
                placeholder="https://your-instance.service-now.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showSnApiKey ? 'text' : 'password'}
                  value={settings.servicenow.apiKey}
                  onChange={(e) => updateServiceNowSettings({ apiKey: e.target.value })}
                  placeholder="Enter your ServiceNow API key"
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowSnApiKey(!showSnApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showSnApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handleSaveServiceNow}
                disabled={!settings.servicenow.apiKey}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors',
                  !settings.servicenow.apiKey
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                )}
              >
                <Save className="w-4 h-4" />
                Save
              </button>

              <button
                onClick={handleTestConnection}
                disabled={testing || !settings.servicenow.instanceUrl || !settings.servicenow.apiKey}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors',
                  testing || !settings.servicenow.instanceUrl || !settings.servicenow.apiKey
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-600 text-white hover:bg-gray-700'
                )}
              >
                {testing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </button>

              {snSaved && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">Settings saved!</span>
                </div>
              )}

              {testResult === 'success' && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">Connection successful!</span>
                </div>
              )}

              {testResult === 'error' && (
                <div className="flex items-center gap-2 text-red-600">
                  <XCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">Connection failed</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Connection Health Check */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <RefreshCw className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">Connection Health</h2>
          </div>
          <ConnectionHealthCheck />
        </div>

        {/* OpenAI Configuration */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Key className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-semibold text-gray-900">OpenAI Configuration</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showOpenAIKey ? 'text' : 'password'}
                  value={settings.openai.apiKey}
                  onChange={(e) => updateOpenAISettings({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showOpenAIKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model
                </label>
                <select
                  value={settings.openai.model}
                  onChange={(e) => updateOpenAISettings({ model: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temperature
                </label>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.openai.temperature}
                  onChange={(e) =>
                    updateOpenAISettings({ temperature: parseFloat(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  min="256"
                  max="16384"
                  step="256"
                  value={settings.openai.maxTokens}
                  onChange={(e) =>
                    updateOpenAISettings({ maxTokens: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handleSaveOpenAI}
                disabled={!settings.openai.apiKey}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors',
                  !settings.openai.apiKey
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                )}
              >
                <Save className="w-4 h-4" />
                Save OpenAI Settings
              </button>

              {openaiSaved && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">Settings saved!</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Default Values */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Default Values</h2>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Default Vendor Manager
                </label>
                <input
                  type="text"
                  value={settings.defaults.vendorManager}
                  onChange={(e) => updateDefaultSettings({ vendorManager: e.target.value })}
                  placeholder="Enter name or sys_id"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Default Contract Administrator
                </label>
                <input
                  type="text"
                  value={settings.defaults.contractAdministrator}
                  onChange={(e) =>
                    updateDefaultSettings({ contractAdministrator: e.target.value })
                  }
                  placeholder="Enter name or sys_id"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Preferred Currency
                </label>
                <select
                  value={settings.defaults.currency}
                  onChange={(e) => updateDefaultSettings({ currency: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="GBP">GBP - British Pound</option>
                  <option value="CAD">CAD - Canadian Dollar</option>
                  <option value="AUD">AUD - Australian Dollar</option>
                </select>
              </div>

              <div className="flex items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.defaults.autoSaveDrafts}
                    onChange={(e) =>
                      updateDefaultSettings({ autoSaveDrafts: e.target.checked })
                    }
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Auto-save draft requests
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Real-time Updates */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <RefreshCw className="w-5 h-5 text-cyan-600" />
            <h2 className="text-lg font-semibold text-gray-900">Real-time Updates</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Enable Auto-refresh
                </label>
                <p className="text-xs text-gray-500">
                  Automatically refresh table data at regular intervals
                </p>
              </div>
              <button
                onClick={() => updatePollingSettings({ enabled: !settings.polling?.enabled })}
                className={clsx(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  settings.polling?.enabled ? 'bg-cyan-600' : 'bg-gray-200'
                )}
              >
                <span
                  className={clsx(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    settings.polling?.enabled ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Refresh Interval (seconds)
                </label>
                <select
                  value={settings.polling?.interval || 30}
                  onChange={(e) => updatePollingSettings({ interval: parseInt(e.target.value) })}
                  disabled={!settings.polling?.enabled}
                  className={clsx(
                    'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500',
                    !settings.polling?.enabled && 'bg-gray-100 text-gray-400'
                  )}
                >
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                  <option value={120}>2 minutes</option>
                  <option value={300}>5 minutes</option>
                </select>
              </div>

              <div className="flex items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.polling?.showLastRefreshed ?? true}
                    onChange={(e) =>
                      updatePollingSettings({ showLastRefreshed: e.target.checked })
                    }
                    disabled={!settings.polling?.enabled}
                    className="w-4 h-4 text-cyan-600 border-gray-300 rounded focus:ring-cyan-500 disabled:opacity-50"
                  />
                  <span className={clsx(
                    'text-sm font-medium',
                    settings.polling?.enabled ? 'text-gray-700' : 'text-gray-400'
                  )}>
                    Show last refreshed timestamp
                  </span>
                </label>
              </div>
            </div>

            {settings.polling?.enabled && (
              <div className="mt-2 p-3 bg-cyan-50 border border-cyan-200 rounded-lg">
                <p className="text-sm text-cyan-700">
                  <strong>Active:</strong> Table views will automatically refresh every {settings.polling.interval} seconds when the tab is focused.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Workflow Automation */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Zap className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Workflow Automation</h2>
                <p className="text-sm text-gray-500">
                  Configure approval levels for API operations
                </p>
              </div>
            </div>
            <Link
              to="/settings/workflows"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg"
            >
              Configure
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
