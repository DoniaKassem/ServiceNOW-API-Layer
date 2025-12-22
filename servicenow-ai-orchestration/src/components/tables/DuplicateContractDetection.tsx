import { useState, useMemo } from 'react';
import {
  Search,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Trash2,
  Merge,
  Eye,
  ChevronRight,
  Filter,
  Brain,
  FileWarning,
  HelpCircle,
  ArrowRight,
  Undo2,
  Clock,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useDuplicateDetectionStore } from '../../stores/duplicateDetectionStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getOpenAIService, initOpenAIService } from '../../services/openai';
import type { DuplicatePair, DuplicateSeverity } from '../../types';

interface DuplicateContractDetectionProps {
  onContractClick?: (contract: Record<string, unknown>) => void;
}

export function DuplicateContractDetection({ onContractClick }: DuplicateContractDetectionProps) {
  const { settings } = useSettingsStore();
  const {
    result,
    resolvedPairs,
    selectedPairId,
    filterSeverity,
    sortBy,
    startScan,
    completeScan,
    failScan,
    resetScan,
    selectPair,
    resolvePair,
    undoResolution,
    setFilterSeverity,
    setSortBy,
  } = useDuplicateDetectionStore();

  const [scanProgress, setScanProgress] = useState(0);
  const [scanMessage, setScanMessage] = useState('');
  const [showConfirmDelete, setShowConfirmDelete] = useState<{ pairId: string; contractSysId: string } | null>(null);

  // Fetch all contracts for scanning
  const { data: contracts, isLoading: isLoadingContracts, refetch: refetchContracts } = useQuery({
    queryKey: ['contracts-for-duplicate-scan'],
    queryFn: async () => {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      const response = await api.get<Record<string, unknown>>('ast_contract', {
        sysparm_fields: 'sys_id,number,short_description,vendor,supplier,starts,ends,payment_amount,total_cost,state,contract_model,active',
        sysparm_limit: 500,
        sysparm_display_value: 'all',
      });

      return response.result || [];
    },
    enabled: !!settings.servicenow.apiKey,
  });

  // Run AI duplicate detection
  const runDuplicateScan = async () => {
    if (!contracts || contracts.length === 0) return;

    startScan();
    setScanProgress(0);
    setScanMessage('Initializing AI analysis...');

    try {
      const openai = (() => {
        try {
          return getOpenAIService();
        } catch {
          return initOpenAIService(
            settings.openai.apiKey,
            settings.openai.model,
            settings.openai.temperature,
            settings.openai.maxTokens
          );
        }
      })();

      const result = await openai.detectDuplicateContracts(contracts, (progress, message) => {
        setScanProgress(progress);
        setScanMessage(message);
      });

      completeScan(result.pairs, result.totalAnalyzed);
      setScanMessage('Scan complete!');
    } catch (error) {
      failScan((error as Error).message);
      setScanMessage('Scan failed');
    }
  };

  // Handle contract deletion
  const handleDeleteContract = async (sysId: string, pairId: string) => {
    try {
      const api = getServiceNowAPI();
      await api.delete('ast_contract', sysId);

      // Mark as resolved
      resolvePair({
        pairId,
        action: 'delete',
        deleteSysId: sysId,
      });

      setShowConfirmDelete(null);
      refetchContracts();
    } catch (error) {
      console.error('Failed to delete contract:', error);
    }
  };

  // Filter and sort pairs
  const filteredPairs = useMemo(() => {
    let pairs = result.pairs;

    // Filter by severity
    if (filterSeverity !== 'all') {
      pairs = pairs.filter((p) => p.severity === filterSeverity);
    }

    // Sort
    pairs = [...pairs].sort((a, b) => {
      switch (sortBy) {
        case 'similarity':
          return b.similarity - a.similarity;
        case 'severity': {
          const severityOrder = { high: 0, medium: 1, low: 2 };
          return severityOrder[a.severity] - severityOrder[b.severity];
        }
        case 'vendor':
          return (a.contract1.vendor || '').localeCompare(b.contract1.vendor || '');
        default:
          return 0;
      }
    });

    return pairs;
  }, [result.pairs, filterSeverity, sortBy]);

  // Check if a pair is resolved
  const isPairResolved = (pairId: string) => resolvedPairs.some((r) => r.pairId === pairId);
  const getResolution = (pairId: string) => resolvedPairs.find((r) => r.pairId === pairId);

  // Statistics
  const stats = useMemo(() => {
    const high = result.pairs.filter((p) => p.severity === 'high').length;
    const medium = result.pairs.filter((p) => p.severity === 'medium').length;
    const low = result.pairs.filter((p) => p.severity === 'low').length;
    const resolved = resolvedPairs.length;

    return { high, medium, low, total: result.pairs.length, resolved };
  }, [result.pairs, resolvedPairs]);

  const getSeverityConfig = (severity: DuplicateSeverity) => {
    switch (severity) {
      case 'high':
        return {
          bg: 'bg-red-50 border-red-200',
          text: 'text-red-700',
          badge: 'bg-red-100 text-red-800',
          icon: <XCircle className="w-5 h-5 text-red-500" />,
          label: 'High Confidence',
        };
      case 'medium':
        return {
          bg: 'bg-orange-50 border-orange-200',
          text: 'text-orange-700',
          badge: 'bg-orange-100 text-orange-800',
          icon: <AlertTriangle className="w-5 h-5 text-orange-500" />,
          label: 'Medium Confidence',
        };
      case 'low':
        return {
          bg: 'bg-yellow-50 border-yellow-200',
          text: 'text-yellow-700',
          badge: 'bg-yellow-100 text-yellow-800',
          icon: <HelpCircle className="w-5 h-5 text-yellow-500" />,
          label: 'Low Confidence',
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

  const selectedPair = selectedPairId ? result.pairs.find((p) => p.id === selectedPairId) : null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <Brain className="w-7 h-7 text-purple-600" />
              AI Duplicate Contract Detection
            </h1>
            <p className="text-gray-500 mt-1">
              Use AI to identify and resolve duplicate contracts in your system
            </p>
          </div>

          <div className="flex items-center gap-3">
            {result.status === 'complete' && (
              <button
                onClick={resetScan}
                className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </button>
            )}
            <button
              onClick={runDuplicateScan}
              disabled={result.status === 'scanning' || isLoadingContracts || !contracts?.length}
              className={clsx(
                'flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-colors',
                result.status === 'scanning'
                  ? 'bg-purple-100 text-purple-700 cursor-wait'
                  : 'bg-purple-600 text-white hover:bg-purple-700'
              )}
            >
              {result.status === 'scanning' ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Scanning... {scanProgress}%
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Scan for Duplicates
                </>
              )}
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {result.status === 'scanning' && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
              <span>{scanMessage}</span>
              <span>{scanProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${scanProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Stats Cards */}
        {result.status === 'complete' && (
          <div className="grid grid-cols-5 gap-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-red-600 font-medium">High Confidence</p>
                  <p className="text-2xl font-bold text-red-700">{stats.high}</p>
                </div>
                <XCircle className="w-8 h-8 text-red-400" />
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-orange-600 font-medium">Medium Confidence</p>
                  <p className="text-2xl font-bold text-orange-700">{stats.medium}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-orange-400" />
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-yellow-600 font-medium">Low Confidence</p>
                  <p className="text-2xl font-bold text-yellow-700">{stats.low}</p>
                </div>
                <HelpCircle className="w-8 h-8 text-yellow-400" />
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-600 font-medium">Total Analyzed</p>
                  <p className="text-2xl font-bold text-blue-700">{result.totalContractsAnalyzed}</p>
                </div>
                <FileWarning className="w-8 h-8 text-blue-400" />
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-600 font-medium">Resolved</p>
                  <p className="text-2xl font-bold text-green-700">{stats.resolved}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      {result.status === 'complete' && result.pairs.length > 0 && (
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-600">Severity:</span>
                <select
                  value={filterSeverity}
                  onChange={(e) => setFilterSeverity(e.target.value as typeof filterSeverity)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                >
                  <option value="all">All</option>
                  <option value="high">High Only</option>
                  <option value="medium">Medium Only</option>
                  <option value="low">Low Only</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Sort by:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                >
                  <option value="severity">Severity</option>
                  <option value="similarity">Similarity Score</option>
                  <option value="vendor">Vendor Name</option>
                </select>
              </div>
            </div>

            <div className="text-sm text-gray-500">
              <Clock className="w-4 h-4 inline mr-1" />
              Last scan: {format(new Date(result.scanDate), 'MMM d, yyyy HH:mm')}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Duplicate Pairs List */}
        <div className={clsx('flex-1 overflow-y-auto p-6', selectedPair && 'w-1/2')}>
          {result.status === 'idle' && (
            <div className="text-center py-12">
              <Brain className="w-16 h-16 mx-auto text-purple-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Ready to Scan</h3>
              <p className="text-gray-500 max-w-md mx-auto">
                Click "Scan for Duplicates" to analyze your contracts using AI.
                The system will identify potential duplicate entries based on vendor,
                description, dates, and values.
              </p>
              {contracts && (
                <p className="text-sm text-gray-400 mt-4">
                  {contracts.length} contracts ready for analysis
                </p>
              )}
            </div>
          )}

          {result.status === 'error' && (
            <div className="text-center py-12">
              <XCircle className="w-16 h-16 mx-auto text-red-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Scan Failed</h3>
              <p className="text-red-600">{result.error}</p>
              <button
                onClick={resetScan}
                className="mt-4 px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 rounded-lg"
              >
                Try Again
              </button>
            </div>
          )}

          {result.status === 'complete' && filteredPairs.length === 0 && (
            <div className="text-center py-12">
              <CheckCircle className="w-16 h-16 mx-auto text-green-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Duplicates Found</h3>
              <p className="text-gray-500">
                {filterSeverity !== 'all'
                  ? `No ${filterSeverity} confidence duplicates found. Try changing the filter.`
                  : 'Your contracts appear to be clean with no duplicate entries detected.'}
              </p>
            </div>
          )}

          {result.status === 'complete' && filteredPairs.length > 0 && (
            <div className="space-y-4">
              {filteredPairs.map((pair) => {
                const config = getSeverityConfig(pair.severity);
                const resolved = isPairResolved(pair.id);
                const resolution = getResolution(pair.id);

                return (
                  <div
                    key={pair.id}
                    onClick={() => selectPair(pair.id === selectedPairId ? null : pair.id)}
                    className={clsx(
                      'border rounded-lg p-4 cursor-pointer transition-all',
                      resolved ? 'bg-gray-50 border-gray-200 opacity-60' : config.bg,
                      selectedPairId === pair.id && 'ring-2 ring-purple-500'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        {resolved ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (
                          config.icon
                        )}
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full', config.badge)}>
                              {pair.similarity}% Match
                            </span>
                            <span className="text-xs text-gray-500">{config.label}</span>
                            {resolved && (
                              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800">
                                Resolved: {resolution?.action}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium text-gray-900">{pair.contract1.number}</span>
                            <ArrowRight className="w-4 h-4 text-gray-400" />
                            <span className="font-medium text-gray-900">{pair.contract2.number}</span>
                          </div>

                          <p className="text-sm text-gray-600 mt-1">
                            Vendor: {pair.contract1.vendor || 'Unknown'}
                          </p>

                          <div className="flex flex-wrap gap-1 mt-2">
                            {pair.matchedFields.slice(0, 4).map((field) => (
                              <span
                                key={field}
                                className="px-2 py-0.5 text-xs bg-white border border-gray-200 rounded"
                              >
                                {field}
                              </span>
                            ))}
                            {pair.matchedFields.length > 4 && (
                              <span className="px-2 py-0.5 text-xs text-gray-500">
                                +{pair.matchedFields.length - 4} more
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <ChevronRight
                        className={clsx(
                          'w-5 h-5 text-gray-400 transition-transform',
                          selectedPairId === pair.id && 'rotate-90'
                        )}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedPair && (
          <div className="w-1/2 border-l border-gray-200 bg-white overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900">Duplicate Pair Details</h2>
                <button
                  onClick={() => selectPair(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* AI Reasoning */}
              <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <Brain className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-purple-900 mb-1">AI Analysis</h3>
                    <p className="text-sm text-purple-800">{selectedPair.aiReasoning}</p>
                    <div className="mt-2 text-sm">
                      <span className="font-medium text-purple-900">Suggested Action: </span>
                      <span className="text-purple-700 capitalize">{selectedPair.suggestedAction.replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contract Comparison */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {/* Contract 1 */}
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-gray-900">Contract 1</h3>
                    <button
                      onClick={() => onContractClick?.(selectedPair.contract1.raw)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-gray-500">Number</dt>
                      <dd className="font-medium">{selectedPair.contract1.number || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Description</dt>
                      <dd>{selectedPair.contract1.short_description || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Vendor</dt>
                      <dd>{selectedPair.contract1.vendor || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Period</dt>
                      <dd>{selectedPair.contract1.starts || '-'} to {selectedPair.contract1.ends || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Value</dt>
                      <dd>{formatCurrency(selectedPair.contract1.total_cost)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">State</dt>
                      <dd>{selectedPair.contract1.state || '-'}</dd>
                    </div>
                  </dl>
                </div>

                {/* Contract 2 */}
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-gray-900">Contract 2</h3>
                    <button
                      onClick={() => onContractClick?.(selectedPair.contract2.raw)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-gray-500">Number</dt>
                      <dd className="font-medium">{selectedPair.contract2.number || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Description</dt>
                      <dd>{selectedPair.contract2.short_description || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Vendor</dt>
                      <dd>{selectedPair.contract2.vendor || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Period</dt>
                      <dd>{selectedPair.contract2.starts || '-'} to {selectedPair.contract2.ends || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Value</dt>
                      <dd>{formatCurrency(selectedPair.contract2.total_cost)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">State</dt>
                      <dd>{selectedPair.contract2.state || '-'}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Matched Fields */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-900 mb-2">Matched Fields</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedPair.matchedFields.map((field) => (
                    <span
                      key={field}
                      className="px-3 py-1 text-sm bg-purple-100 text-purple-800 rounded-full"
                    >
                      {field}
                    </span>
                  ))}
                </div>
              </div>

              {/* Actions */}
              {!isPairResolved(selectedPair.id) ? (
                <div className="border-t border-gray-200 pt-6">
                  <h3 className="text-sm font-medium text-gray-900 mb-4">Resolution Actions</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => {
                        resolvePair({
                          pairId: selectedPair.id,
                          action: 'keep',
                          notes: 'Both contracts are valid',
                        });
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Keep Both
                    </button>

                    <button
                      onClick={() => setShowConfirmDelete({ pairId: selectedPair.id, contractSysId: selectedPair.contract1.sys_id })}
                      className="flex items-center justify-center gap-2 px-4 py-2 border border-red-300 rounded-lg text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Contract 1
                    </button>

                    <button
                      onClick={() => setShowConfirmDelete({ pairId: selectedPair.id, contractSysId: selectedPair.contract2.sys_id })}
                      className="flex items-center justify-center gap-2 px-4 py-2 border border-red-300 rounded-lg text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Contract 2
                    </button>

                    <button
                      onClick={() => {
                        resolvePair({
                          pairId: selectedPair.id,
                          action: 'skip',
                          notes: 'Skipped for later review',
                        });
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      <ArrowRight className="w-4 h-4" />
                      Skip for Now
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border-t border-gray-200 pt-6">
                  <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="text-green-800">
                        Resolved: {getResolution(selectedPair.id)?.action}
                      </span>
                    </div>
                    <button
                      onClick={() => undoResolution(selectedPair.id)}
                      className="flex items-center gap-1 text-sm text-green-700 hover:text-green-900"
                    >
                      <Undo2 className="w-4 h-4" />
                      Undo
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showConfirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Deletion</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete this contract? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmDelete(null)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteContract(showConfirmDelete.contractSysId, showConfirmDelete.pairId)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete Contract
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
