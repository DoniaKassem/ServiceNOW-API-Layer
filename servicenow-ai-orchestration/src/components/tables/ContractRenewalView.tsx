import { useState, useMemo } from 'react';
import {
  Calendar,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  ChevronRight,
  RefreshCw,
  Bell,
  TrendingUp,
  DollarSign,
  FileText,
  Filter,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format, differenceInDays, addMonths, isAfter, isBefore, parseISO } from 'date-fns';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getSysId, getDisplayValue } from '../../utils/serviceNowHelpers';

interface ContractRenewalViewProps {
  onContractClick: (contract: Record<string, unknown>) => void;
  onRefresh: () => void;
}

type RenewalUrgency = 'critical' | 'warning' | 'upcoming' | 'safe';
type FilterPeriod = '30' | '60' | '90' | '180' | 'all';

interface RenewalContract {
  sys_id: string;
  number: string;
  short_description: string;
  vendor: string;
  vendorSysId: string;
  supplier: string;
  starts: Date | null;
  ends: Date | null;
  daysToRenewal: number;
  urgency: RenewalUrgency;
  renewable: boolean;
  state: string;
  payment_amount: string;
  total_cost: string;
  raw: Record<string, unknown>;
}

export function ContractRenewalView({ onContractClick, onRefresh }: ContractRenewalViewProps) {
  const { settings } = useSettingsStore();
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('180');
  const [showOnlyRenewable, setShowOnlyRenewable] = useState(false);
  const [sortBy, setSortBy] = useState<'daysToRenewal' | 'value'>('daysToRenewal');

  // Fetch contracts with upcoming end dates
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['contracts-renewal', filterPeriod],
    queryFn: async () => {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      const today = new Date();
      const endDate = filterPeriod === 'all'
        ? addMonths(today, 24) // 2 years for "all"
        : addMonths(today, parseInt(filterPeriod) / 30);

      // Query for contracts ending within the period
      const query = `ends>=${format(today, 'yyyy-MM-dd')}^ends<=${format(endDate, 'yyyy-MM-dd')}^stateNOT IN7,8`; // Exclude cancelled/closed

      const response = await api.get<Record<string, unknown>>('ast_contract', {
        sysparm_query: query,
        sysparm_fields: 'sys_id,number,short_description,vendor,supplier,starts,ends,renewable,state,payment_amount,total_cost',
        sysparm_limit: 100,
        sysparm_display_value: 'all',
      });

      return response.result || [];
    },
    enabled: !!settings.servicenow.apiKey,
  });

  // Process and categorize contracts
  const processedContracts = useMemo((): RenewalContract[] => {
    if (!data) return [];

    const today = new Date();

    return data.map((contract) => {
      const endsStr = getDisplayValue(contract.ends);
      const startsStr = getDisplayValue(contract.starts);
      const ends = endsStr ? parseISO(endsStr) : null;
      const starts = startsStr ? parseISO(startsStr) : null;

      const daysToRenewal = ends ? differenceInDays(ends, today) : 999;

      let urgency: RenewalUrgency = 'safe';
      if (daysToRenewal <= 30) {
        urgency = 'critical';
      } else if (daysToRenewal <= 60) {
        urgency = 'warning';
      } else if (daysToRenewal <= 90) {
        urgency = 'upcoming';
      }

      const renewableValue = getDisplayValue(contract.renewable);
      const renewable = renewableValue === 'true' || renewableValue === '1' || renewableValue.toLowerCase() === 'yes';

      return {
        sys_id: getSysId(contract.sys_id),
        number: getDisplayValue(contract.number),
        short_description: getDisplayValue(contract.short_description),
        vendor: getDisplayValue(contract.vendor),
        vendorSysId: getSysId((contract.vendor as { value?: string })?.value || ''),
        supplier: getDisplayValue(contract.supplier),
        starts,
        ends,
        daysToRenewal,
        urgency,
        renewable,
        state: getDisplayValue(contract.state),
        payment_amount: getDisplayValue(contract.payment_amount),
        total_cost: getDisplayValue(contract.total_cost),
        raw: contract,
      };
    });
  }, [data]);

  // Filter and sort contracts
  const filteredContracts = useMemo(() => {
    let filtered = processedContracts;

    if (showOnlyRenewable) {
      filtered = filtered.filter(c => c.renewable);
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'daysToRenewal') {
        return a.daysToRenewal - b.daysToRenewal;
      } else {
        const aValue = parseFloat(a.total_cost || a.payment_amount || '0') || 0;
        const bValue = parseFloat(b.total_cost || b.payment_amount || '0') || 0;
        return bValue - aValue;
      }
    });

    return filtered;
  }, [processedContracts, showOnlyRenewable, sortBy]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const critical = filteredContracts.filter(c => c.urgency === 'critical').length;
    const warning = filteredContracts.filter(c => c.urgency === 'warning').length;
    const upcoming = filteredContracts.filter(c => c.urgency === 'upcoming').length;
    const totalValue = filteredContracts.reduce((sum, c) => {
      const value = parseFloat(c.total_cost || c.payment_amount || '0') || 0;
      return sum + value;
    }, 0);

    return { critical, warning, upcoming, total: filteredContracts.length, totalValue };
  }, [filteredContracts]);

  const getUrgencyConfig = (urgency: RenewalUrgency) => {
    switch (urgency) {
      case 'critical':
        return {
          bg: 'bg-red-50 border-red-200',
          text: 'text-red-700',
          badge: 'bg-red-100 text-red-800',
          icon: <XCircle className="w-5 h-5 text-red-500" />,
          label: 'Critical',
        };
      case 'warning':
        return {
          bg: 'bg-orange-50 border-orange-200',
          text: 'text-orange-700',
          badge: 'bg-orange-100 text-orange-800',
          icon: <AlertTriangle className="w-5 h-5 text-orange-500" />,
          label: 'Warning',
        };
      case 'upcoming':
        return {
          bg: 'bg-yellow-50 border-yellow-200',
          text: 'text-yellow-700',
          badge: 'bg-yellow-100 text-yellow-800',
          icon: <Clock className="w-5 h-5 text-yellow-500" />,
          label: 'Upcoming',
        };
      default:
        return {
          bg: 'bg-green-50 border-green-200',
          text: 'text-green-700',
          badge: 'bg-green-100 text-green-800',
          icon: <CheckCircle className="w-5 h-5 text-green-500" />,
          label: 'Safe',
        };
    }
  };

  const formatCurrency = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Failed to load renewal data: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Summary Cards */}
      <div className="p-6 bg-white border-b border-gray-200">
        <div className="grid grid-cols-5 gap-4">
          {/* Critical */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-red-600 font-medium">Critical</p>
                <p className="text-2xl font-bold text-red-700">{stats.critical}</p>
                <p className="text-xs text-red-500 mt-1">Within 30 days</p>
              </div>
              <div className="p-3 bg-red-100 rounded-full">
                <XCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </div>

          {/* Warning */}
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-orange-600 font-medium">Warning</p>
                <p className="text-2xl font-bold text-orange-700">{stats.warning}</p>
                <p className="text-xs text-orange-500 mt-1">31-60 days</p>
              </div>
              <div className="p-3 bg-orange-100 rounded-full">
                <AlertTriangle className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </div>

          {/* Upcoming */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-yellow-600 font-medium">Upcoming</p>
                <p className="text-2xl font-bold text-yellow-700">{stats.upcoming}</p>
                <p className="text-xs text-yellow-500 mt-1">61-90 days</p>
              </div>
              <div className="p-3 bg-yellow-100 rounded-full">
                <Clock className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
          </div>

          {/* Total Contracts */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600 font-medium">Total Renewals</p>
                <p className="text-2xl font-bold text-blue-700">{stats.total}</p>
                <p className="text-xs text-blue-500 mt-1">In selected period</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-full">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          {/* Total Value */}
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-purple-600 font-medium">Total Value</p>
                <p className="text-2xl font-bold text-purple-700">
                  {formatCurrency(stats.totalValue.toString())}
                </p>
                <p className="text-xs text-purple-500 mt-1">At risk</p>
              </div>
              <div className="p-3 bg-purple-100 rounded-full">
                <DollarSign className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Period Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-600">Period:</span>
              <select
                value={filterPeriod}
                onChange={(e) => setFilterPeriod(e.target.value as FilterPeriod)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="30">Next 30 days</option>
                <option value="60">Next 60 days</option>
                <option value="90">Next 90 days</option>
                <option value="180">Next 6 months</option>
                <option value="all">All upcoming</option>
              </select>
            </div>

            {/* Sort By */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'daysToRenewal' | 'value')}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="daysToRenewal">Days to Renewal</option>
                <option value="value">Contract Value</option>
              </select>
            </div>

            {/* Renewable Only */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyRenewable}
                onChange={(e) => setShowOnlyRenewable(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">Show only renewable</span>
            </label>
          </div>

          <button
            onClick={() => {
              refetch();
              onRefresh();
            }}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RefreshCw className={clsx('w-4 h-4', isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Contract List */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : filteredContracts.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
            <p className="text-gray-600 font-medium">No contracts due for renewal</p>
            <p className="text-sm text-gray-500 mt-2">
              No contracts are expiring in the selected period.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredContracts.map((contract) => {
              const config = getUrgencyConfig(contract.urgency);

              return (
                <div
                  key={contract.sys_id}
                  onClick={() => onContractClick(contract.raw)}
                  className={clsx(
                    'border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md',
                    config.bg
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      {config.icon}
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-medium text-gray-900">{contract.number}</span>
                          <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full', config.badge)}>
                            {config.label}
                          </span>
                          {contract.renewable && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                              Renewable
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mb-2">
                          {contract.short_description || '(No description)'}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>Vendor: <span className="font-medium text-gray-700">{contract.vendor || '-'}</span></span>
                          <span>|</span>
                          <span>State: <span className="font-medium text-gray-700">{contract.state || '-'}</span></span>
                          {(contract.total_cost || contract.payment_amount) && (
                            <>
                              <span>|</span>
                              <span>Value: <span className="font-medium text-gray-700">{formatCurrency(contract.total_cost || contract.payment_amount)}</span></span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className={clsx('text-2xl font-bold', config.text)}>
                        {contract.daysToRenewal}
                      </div>
                      <div className="text-xs text-gray-500">days left</div>
                      {contract.ends && (
                        <div className="text-xs text-gray-400 mt-1">
                          Ends: {format(contract.ends, 'MMM d, yyyy')}
                        </div>
                      )}
                      <ChevronRight className="w-4 h-4 text-gray-400 mt-2 ml-auto" />
                    </div>
                  </div>

                  {/* Renewal Alert Bar */}
                  {contract.daysToRenewal <= 30 && (
                    <div className="mt-3 pt-3 border-t border-red-200">
                      <div className="flex items-center gap-2 text-sm text-red-700">
                        <Bell className="w-4 h-4" />
                        <span className="font-medium">Action Required:</span>
                        <span>
                          {contract.renewable
                            ? 'Initiate renewal process immediately'
                            : 'Review contract terms and decide on renewal or termination'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
