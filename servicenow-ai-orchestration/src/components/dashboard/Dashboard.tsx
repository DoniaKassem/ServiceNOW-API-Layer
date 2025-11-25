import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import {
  FileText,
  ShoppingCart,
  Users,
  Building2,
  TrendingUp,
  RefreshCw,
  Loader2,
  AlertCircle,
  DollarSign,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { TABLE_VIEW_CONFIG } from '../../types';

// Chart colors
const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

interface DashboardStats {
  contracts: number;
  purchaseOrders: number;
  suppliers: number;
  vendors: number;
  totalContractValue: number;
  contractsByVendor: { name: string; value: number; count: number }[];
  poByStatus: { name: string; value: number }[];
  monthlySpending: { month: string; contracts: number; pos: number }[];
}

export function AnalyticsDashboard() {
  const { settings } = useSettingsStore();
  const [refreshKey, setRefreshKey] = useState(0);

  const getApi = useCallback(() => {
    if (!settings.servicenow.apiKey || !settings.servicenow.instanceUrl) {
      return null;
    }
    try {
      return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    } catch {
      return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    }
  }, [settings.servicenow]);

  // Fetch dashboard stats
  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-stats', refreshKey],
    queryFn: async (): Promise<DashboardStats> => {
      const api = getApi();
      if (!api) throw new Error('API not configured');

      // Fetch counts for all tables in parallel
      const [contractsRes, posRes, suppliersRes, vendorsRes] = await Promise.all([
        api.get('ast_contract', { sysparm_limit: 1000, sysparm_fields: 'sys_id,vendor,total_cost,payment_amount,state' }),
        api.get('sn_shop_purchase_order', { sysparm_limit: 1000, sysparm_fields: 'sys_id,status,total_amount,supplier' }),
        api.get('sn_fin_supplier', { sysparm_limit: 1000, sysparm_fields: 'sys_id,name' }),
        api.get('core_company', { sysparm_query: 'vendor=true', sysparm_limit: 1000, sysparm_fields: 'sys_id,name' }),
      ]);

      const contracts = contractsRes.result || [];
      const pos = posRes.result || [];
      const suppliers = suppliersRes.result || [];
      const vendors = vendorsRes.result || [];

      // Calculate total contract value
      let totalContractValue = 0;
      const vendorValues: Record<string, { name: string; value: number; count: number }> = {};

      for (const contractItem of contracts) {
        const contract = contractItem as Record<string, unknown>;
        const value = parseFloat(String(contract.total_cost || contract.payment_amount || 0));
        totalContractValue += value;

        // Group by vendor
        const vendorRef = contract.vendor as { display_value?: string; value?: string } | string;
        const vendorName = typeof vendorRef === 'object'
          ? (vendorRef?.display_value || 'Unknown')
          : (vendorRef || 'Unknown');

        if (!vendorValues[vendorName]) {
          vendorValues[vendorName] = { name: vendorName, value: 0, count: 0 };
        }
        vendorValues[vendorName].value += value;
        vendorValues[vendorName].count += 1;
      }

      // Calculate PO by status
      const statusCounts: Record<string, number> = {};
      for (const poItem of pos) {
        const po = poItem as Record<string, unknown>;
        const statusRef = po.status as { display_value?: string } | string;
        const status = typeof statusRef === 'object'
          ? (statusRef?.display_value || 'Unknown')
          : (statusRef || 'Unknown');
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }

      // Generate monthly data (mock for demo - in production would aggregate by date)
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
      const monthlySpending = months.map((month) => ({
        month,
        contracts: Math.floor(contracts.length * (0.1 + Math.random() * 0.2)),
        pos: Math.floor(pos.length * (0.1 + Math.random() * 0.2)),
      }));

      return {
        contracts: contracts.length,
        purchaseOrders: pos.length,
        suppliers: suppliers.length,
        vendors: vendors.length,
        totalContractValue,
        contractsByVendor: Object.values(vendorValues)
          .sort((a, b) => b.value - a.value)
          .slice(0, 8),
        poByStatus: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
        monthlySpending,
      };
    },
    enabled: !!settings.servicenow.apiKey,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
    refetch();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: settings.defaults.currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  if (!settings.servicenow.apiKey) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">API Not Configured</h2>
          <p className="text-gray-500">Please configure your ServiceNow API key in Settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              ServiceNow data analytics and insights
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-600">{(error as Error).message}</p>
          </div>
        </div>
      ) : stats ? (
        <div className="p-6 space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              icon={FileText}
              label="Contracts"
              value={stats.contracts}
              color="blue"
            />
            <StatCard
              icon={ShoppingCart}
              label="Purchase Orders"
              value={stats.purchaseOrders}
              color="green"
            />
            <StatCard
              icon={Users}
              label="Suppliers"
              value={stats.suppliers}
              color="purple"
            />
            <StatCard
              icon={Building2}
              label="Vendors"
              value={stats.vendors}
              color="orange"
            />
            <StatCard
              icon={DollarSign}
              label="Total Contract Value"
              value={formatCurrency(stats.totalContractValue)}
              color="emerald"
              isLarge
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Contract Value by Vendor */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Contract Value by Vendor
              </h3>
              {stats.contractsByVendor.length > 0 ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={stats.contractsByVendor}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={90}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        labelFormatter={(label) => `Vendor: ${label}`}
                      />
                      <Bar dataKey="value" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-80 flex items-center justify-center text-gray-500">
                  No contract data available
                </div>
              )}
            </div>

            {/* PO Status Distribution */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Purchase Order Status
              </h3>
              {stats.poByStatus.length > 0 ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.poByStatus}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {stats.poByStatus.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-80 flex items-center justify-center text-gray-500">
                  No purchase order data available
                </div>
              )}
            </div>
          </div>

          {/* Trends Chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-500" />
                Record Distribution (Sample)
              </div>
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.monthlySpending}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="contracts"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    name="Contracts"
                  />
                  <Line
                    type="monotone"
                    dataKey="pos"
                    stroke="#10B981"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    name="Purchase Orders"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Quick Stats Table */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Table Overview
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Table</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">ServiceNow Table</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">Record Count</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(TABLE_VIEW_CONFIG).map(([key, config]) => {
                    const count = key === 'contracts' ? stats.contracts
                      : key === 'purchase_orders' ? stats.purchaseOrders
                      : key === 'suppliers' ? stats.suppliers
                      : key === 'vendors' ? stats.vendors
                      : 0;
                    return (
                      <tr key={key} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm font-medium text-gray-900">
                          {config.label}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-500 font-mono">
                          {config.table}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-900 text-right font-semibold">
                          {count.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Stat Card Component
function StatCard({
  icon: Icon,
  label,
  value,
  color,
  isLarge,
}: {
  icon: typeof FileText;
  label: string;
  value: number | string;
  color: 'blue' | 'green' | 'purple' | 'orange' | 'emerald';
  isLarge?: boolean;
}) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
    emerald: 'bg-emerald-100 text-emerald-600',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className={`font-bold text-gray-900 ${isLarge ? 'text-xl' : 'text-2xl'}`}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
        </div>
      </div>
    </div>
  );
}
