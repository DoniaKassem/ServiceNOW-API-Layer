import { useState, useCallback } from 'react';
import {
  Activity,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Server,
  Key,
  Clock,
  Globe,
  Shield,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';

interface HealthCheckResult {
  status: 'success' | 'error' | 'warning';
  message: string;
  latency?: number;
  details?: string;
}

interface ConnectionHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy' | 'unchecked';
  checks: {
    apiConnection: HealthCheckResult | null;
    authentication: HealthCheckResult | null;
    tableAccess: HealthCheckResult | null;
  };
  lastChecked: string | null;
}

export function ConnectionHealthCheck() {
  const { settings } = useSettingsStore();
  const [isChecking, setIsChecking] = useState(false);
  const [health, setHealth] = useState<ConnectionHealth>({
    overall: 'unchecked',
    checks: {
      apiConnection: null,
      authentication: null,
      tableAccess: null,
    },
    lastChecked: null,
  });

  const runHealthCheck = useCallback(async () => {
    if (!settings.servicenow.instanceUrl || !settings.servicenow.apiKey) {
      setHealth({
        overall: 'unhealthy',
        checks: {
          apiConnection: {
            status: 'error',
            message: 'Configuration Missing',
            details: 'Please configure your ServiceNow instance URL and API key in settings.',
          },
          authentication: null,
          tableAccess: null,
        },
        lastChecked: new Date().toISOString(),
      });
      return;
    }

    setIsChecking(true);

    const checks: ConnectionHealth['checks'] = {
      apiConnection: null,
      authentication: null,
      tableAccess: null,
    };

    // Check 1: API Connection
    try {
      const startTime = Date.now();
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      // Try to fetch a simple endpoint
      await api.get('sys_properties', {
        sysparm_limit: 1,
        sysparm_fields: 'sys_id',
      });

      const latency = Date.now() - startTime;

      checks.apiConnection = {
        status: latency < 2000 ? 'success' : 'warning',
        message: latency < 2000 ? 'Connection Successful' : 'Slow Connection',
        latency,
        details: latency < 2000
          ? `Response time: ${latency}ms`
          : `Response time: ${latency}ms (>2s may indicate network issues)`,
      };

      // Check 2: Authentication
      checks.authentication = {
        status: 'success',
        message: 'Authenticated',
        details: 'API key is valid and accepted',
      };

      // Check 3: Table Access
      const tableStartTime = Date.now();
      await api.get('core_company', {
        sysparm_limit: 1,
        sysparm_fields: 'sys_id',
      });
      const tableLatency = Date.now() - tableStartTime;

      checks.tableAccess = {
        status: 'success',
        message: 'Table Access OK',
        latency: tableLatency,
        details: 'Successfully accessed core_company table',
      };

    } catch (err: unknown) {
      const error = err as { response?: { status?: number }; message?: string };

      if (error.response?.status === 401 || error.response?.status === 403) {
        checks.apiConnection = {
          status: 'success',
          message: 'Server Reachable',
        };
        checks.authentication = {
          status: 'error',
          message: 'Authentication Failed',
          details: error.response?.status === 401
            ? 'Invalid API key. Please check your credentials.'
            : 'Access denied. Your API key may lack required permissions.',
        };
      } else if (error.message?.includes('Network Error') || error.message?.includes('ECONNREFUSED')) {
        checks.apiConnection = {
          status: 'error',
          message: 'Connection Failed',
          details: 'Unable to reach ServiceNow instance. Check URL and network connectivity.',
        };
      } else {
        checks.apiConnection = {
          status: 'error',
          message: 'Connection Error',
          details: error.message || 'Unknown error occurred',
        };
      }
    }

    // Determine overall health
    let overall: ConnectionHealth['overall'] = 'healthy';
    const allChecks = Object.values(checks).filter((c) => c !== null);
    const hasError = allChecks.some((c) => c?.status === 'error');
    const hasWarning = allChecks.some((c) => c?.status === 'warning');

    if (hasError) overall = 'unhealthy';
    else if (hasWarning) overall = 'degraded';

    setHealth({
      overall,
      checks,
      lastChecked: new Date().toISOString(),
    });

    setIsChecking(false);
  }, [settings.servicenow]);

  const overallStyles = {
    healthy: 'bg-green-50 border-green-200 text-green-700',
    degraded: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    unhealthy: 'bg-red-50 border-red-200 text-red-700',
    unchecked: 'bg-gray-50 border-gray-200 text-gray-600',
  };

  const overallIcons = {
    healthy: CheckCircle,
    degraded: AlertCircle,
    unhealthy: XCircle,
    unchecked: Activity,
  };

  const OverallIcon = overallIcons[health.overall];

  const checkItems = [
    {
      key: 'apiConnection',
      label: 'API Connection',
      icon: Globe,
      check: health.checks.apiConnection,
    },
    {
      key: 'authentication',
      label: 'Authentication',
      icon: Key,
      check: health.checks.authentication,
    },
    {
      key: 'tableAccess',
      label: 'Table Access',
      icon: Server,
      check: health.checks.tableAccess,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Overall Status */}
      <div className={clsx(
        'flex items-center justify-between p-4 rounded-lg border',
        overallStyles[health.overall]
      )}>
        <div className="flex items-center gap-3">
          <OverallIcon className="w-6 h-6" />
          <div>
            <p className="font-medium">
              {health.overall === 'healthy' && 'All Systems Operational'}
              {health.overall === 'degraded' && 'Degraded Performance'}
              {health.overall === 'unhealthy' && 'Connection Issues'}
              {health.overall === 'unchecked' && 'Not Yet Checked'}
            </p>
            {health.lastChecked && (
              <p className="text-xs opacity-75 flex items-center gap-1 mt-0.5">
                <Clock className="w-3 h-3" />
                Last checked: {new Date(health.lastChecked).toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={runHealthCheck}
          disabled={isChecking}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
            'bg-white/80 hover:bg-white border border-current/20'
          )}
        >
          <RefreshCw className={clsx('w-4 h-4', isChecking && 'animate-spin')} />
          {isChecking ? 'Checking...' : 'Run Check'}
        </button>
      </div>

      {/* Individual Checks */}
      <div className="grid grid-cols-1 gap-3">
        {checkItems.map(({ key, label, icon: Icon, check }) => (
          <div
            key={key}
            className={clsx(
              'flex items-center justify-between p-3 rounded-lg border',
              !check && 'bg-gray-50 border-gray-200',
              check?.status === 'success' && 'bg-green-50 border-green-200',
              check?.status === 'warning' && 'bg-yellow-50 border-yellow-200',
              check?.status === 'error' && 'bg-red-50 border-red-200'
            )}
          >
            <div className="flex items-center gap-3">
              <div className={clsx(
                'p-2 rounded-lg',
                !check && 'bg-gray-100',
                check?.status === 'success' && 'bg-green-100',
                check?.status === 'warning' && 'bg-yellow-100',
                check?.status === 'error' && 'bg-red-100'
              )}>
                <Icon className={clsx(
                  'w-4 h-4',
                  !check && 'text-gray-400',
                  check?.status === 'success' && 'text-green-600',
                  check?.status === 'warning' && 'text-yellow-600',
                  check?.status === 'error' && 'text-red-600'
                )} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{label}</p>
                {check && (
                  <p className={clsx(
                    'text-xs',
                    check.status === 'success' && 'text-green-600',
                    check.status === 'warning' && 'text-yellow-600',
                    check.status === 'error' && 'text-red-600'
                  )}>
                    {check.message}
                  </p>
                )}
                {check?.details && (
                  <p className="text-xs text-gray-500 mt-0.5">{check.details}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {check?.latency && (
                <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded">
                  {check.latency}ms
                </span>
              )}
              {!check && <span className="text-xs text-gray-400">Not checked</span>}
              {check?.status === 'success' && <CheckCircle className="w-5 h-5 text-green-500" />}
              {check?.status === 'warning' && <AlertCircle className="w-5 h-5 text-yellow-500" />}
              {check?.status === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
            </div>
          </div>
        ))}
      </div>

      {/* Security Info */}
      <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <Shield className="w-5 h-5 text-blue-500 mt-0.5" />
        <div className="text-sm text-blue-700">
          <p className="font-medium">Secure Connection</p>
          <p className="text-xs text-blue-600 mt-0.5">
            All API requests are made over HTTPS. Your API key is stored locally in your browser.
          </p>
        </div>
      </div>
    </div>
  );
}

// Compact health indicator for header/status bar
export function ConnectionStatusIndicator() {
  const { settings } = useSettingsStore();
  const [status, setStatus] = useState<'unknown' | 'checking' | 'connected' | 'error'>('unknown');

  const checkConnection = useCallback(async () => {
    if (!settings.servicenow.instanceUrl || !settings.servicenow.apiKey) {
      setStatus('error');
      return;
    }

    setStatus('checking');
    try {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      await api.get('sys_properties', {
        sysparm_limit: 1,
        sysparm_fields: 'sys_id',
      });
      setStatus('connected');
    } catch {
      setStatus('error');
    }
  }, [settings.servicenow]);

  return (
    <button
      onClick={checkConnection}
      className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100 transition-colors"
      title="Click to check connection status"
    >
      <div className={clsx(
        'w-2 h-2 rounded-full',
        status === 'unknown' && 'bg-gray-400',
        status === 'checking' && 'bg-yellow-400 animate-pulse',
        status === 'connected' && 'bg-green-500',
        status === 'error' && 'bg-red-500'
      )} />
      <span className="text-gray-600">
        {status === 'unknown' && 'Check Status'}
        {status === 'checking' && 'Checking...'}
        {status === 'connected' && 'Connected'}
        {status === 'error' && 'Disconnected'}
      </span>
    </button>
  );
}
