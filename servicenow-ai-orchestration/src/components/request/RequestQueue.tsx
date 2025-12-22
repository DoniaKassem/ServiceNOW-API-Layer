import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  List,
  Play,
  Trash2,
  Edit2,
  Check,
  X,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  ArrowUpDown,
  RefreshCw,
  Archive,
  Plus,
} from 'lucide-react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { clsx } from 'clsx';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { initServiceNowAPI } from '../../services/servicenow';
import { dryRun, sortRequestsByDependency } from '../../services/execution';
import type { APIRequest, RequestStatus } from '../../types';
import { TABLE_NAMES } from '../../types';

SyntaxHighlighter.registerLanguage('json', json);

const statusIcons: Record<RequestStatus, ReactElement> = {
  pending: <Clock className="w-4 h-4 text-gray-400" />,
  approved: <Check className="w-4 h-4 text-green-500" />,
  executing: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  success: <CheckCircle className="w-4 h-4 text-green-600" />,
  failed: <AlertCircle className="w-4 h-4 text-red-600" />,
};

const statusColors: Record<RequestStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  approved: 'bg-green-100 text-green-700',
  executing: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export function RequestQueue() {
  const { getCurrentSession, updateRequest, removeRequest, setRequestStatus, addAuditEntry, updateSessionStatus, setCurrentSession } =
    useSessionStore();
  const { settings } = useSettingsStore();
  const navigate = useNavigate();

  const session = getCurrentSession();
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState<string | null>(null);
  const [editedBodyText, setEditedBodyText] = useState('');
  const [executing, setExecuting] = useState(false);
  const [retryingRequestId, setRetryingRequestId] = useState<string | null>(null);
  const [validationResults, setValidationResults] = useState<
    Array<{ requestId: string; valid: boolean; errors: string[] }> | null
  >(null);

  if (!session) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <List className="w-8 h-8 text-gray-700" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Request Queue</h1>
            <p className="text-gray-500">Manage and execute API requests</p>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <List className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No active session</p>
          <p className="text-sm text-gray-400 mt-2">
            Upload a document to create a session and generate requests
          </p>
        </div>
      </div>
    );
  }

  const requests = session.requests;
  const sortedRequests = sortRequestsByDependency(requests);
  const selectedRequest = requests.find((r) => r.id === selectedRequestId);

  const handleApprove = (requestId: string) => {
    setRequestStatus(session.id, requestId, 'approved');
  };

  const handleReject = (requestId: string) => {
    setRequestStatus(session.id, requestId, 'pending');
  };

  const handleDelete = (requestId: string) => {
    removeRequest(session.id, requestId);
    if (selectedRequestId === requestId) {
      setSelectedRequestId(null);
    }
  };

  const handleStartEdit = (request: APIRequest) => {
    setEditingBody(request.id);
    setEditedBodyText(JSON.stringify(request.modifiedBody || request.body, null, 2));
  };

  const handleSaveEdit = (requestId: string) => {
    try {
      const newBody = JSON.parse(editedBodyText);
      updateRequest(session.id, requestId, { modifiedBody: newBody });
      setEditingBody(null);
    } catch {
      // Invalid JSON - don't save
    }
  };

  const handleCancelEdit = () => {
    setEditingBody(null);
    setEditedBodyText('');
  };

  const handleDryRun = () => {
    if (requests.length === 0) {
      setValidationResults([]);
      return;
    }
    const result = dryRun(requests);
    setValidationResults(result.results);
  };

  const handleExecuteAll = async () => {
    if (!settings.servicenow.apiKey) return;

    setExecuting(true);
    setValidationResults(null);

    const api = initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);

    // Get fresh session data
    const currentSession = getCurrentSession();
    if (!currentSession) {
      setExecuting(false);
      return;
    }

    const currentRequests = currentSession.requests;
    const approvedRequests = currentRequests.filter((r) => r.status === 'approved');

    // Track completed results for dependency resolution during execution
    const completedResults = new Map<string, string>(); // entityType -> sys_id

    // Pre-resolve dependencies from already successful requests
    const preResolvedRequests = approvedRequests.map((request) => {
      const body = request.modifiedBody || request.body;
      const resolvedBody: Record<string, unknown> = { ...body };

      for (const [key, value] of Object.entries(resolvedBody)) {
        if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
          const placeholder = value.slice(2, -2);
          const [entityType, field] = placeholder.split('.');

          if (field === 'sys_id') {
            // First check if we have a result from this batch
            const batchSysId = completedResults.get(entityType);
            if (batchSysId) {
              resolvedBody[key] = batchSysId;
              continue;
            }

            // Otherwise check already successful requests from previous executions
            const successfulRequest = currentRequests.find(
              (r) => r.entityType === entityType && r.status === 'success' && r.response
            );

            if (successfulRequest?.response?.data) {
              const responseData = successfulRequest.response.data as { result?: { sys_id?: string } };
              const sysId = responseData?.result?.sys_id;
              if (sysId) {
                resolvedBody[key] = sysId;
              }
            }
          }
        }
      }

      return { ...request, body: resolvedBody };
    });

    // Execute with real-time dependency resolution for sequential requests
    for (const request of sortRequestsByDependency(preResolvedRequests)) {
      // Re-resolve dependencies in case earlier requests in this batch provided sys_ids
      const body = request.body;
      const resolvedBody: Record<string, unknown> = { ...body };

      for (const [key, value] of Object.entries(resolvedBody)) {
        if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
          const placeholder = value.slice(2, -2);
          const [entityType, field] = placeholder.split('.');

          if (field === 'sys_id') {
            const batchSysId = completedResults.get(entityType);
            if (batchSysId) {
              resolvedBody[key] = batchSysId;
            }
          }
        }
      }

      const resolvedRequest = { ...request, body: resolvedBody };

      setRequestStatus(currentSession.id, request.id, 'executing');

      try {
        const response = await api.executeRequest(
          resolvedRequest.method,
          resolvedRequest.url,
          resolvedRequest.headers,
          resolvedRequest.body as Record<string, unknown>
        );

        const success = response.status >= 200 && response.status < 300;
        let sysId: string | undefined;

        if (success) {
          const data = response.data as { result?: { sys_id?: string } };
          sysId = data?.result?.sys_id;

          // Store for dependent requests
          if (sysId) {
            completedResults.set(request.entityType, sysId);
          }

          setRequestStatus(currentSession.id, request.id, 'success');
          // Store both the response AND the resolved body so UI shows resolved values
          updateRequest(currentSession.id, request.id, {
            response: response,
            modifiedBody: resolvedBody,
          });
          addAuditEntry(
            currentSession.id,
            'REQUEST_SUCCESS',
            `Request completed successfully. sys_id: ${sysId || 'N/A'}`
          );
        } else {
          setRequestStatus(currentSession.id, request.id, 'failed');
          updateRequest(currentSession.id, request.id, { response: response });
          addAuditEntry(
            currentSession.id,
            'REQUEST_FAILED',
            `Request failed: ${response.error || response.statusText}`
          );
          // Stop on error
          break;
        }
      } catch (error) {
        const errorResponse = {
          status: 500,
          statusText: 'Internal Error',
          data: null,
          headers: {},
          error: error instanceof Error ? error.message : 'Unknown error',
        };

        setRequestStatus(currentSession.id, request.id, 'failed');
        updateRequest(currentSession.id, request.id, { response: errorResponse });
        addAuditEntry(
          currentSession.id,
          'REQUEST_FAILED',
          `Request failed: ${errorResponse.error}`
        );
        // Stop on error
        break;
      }
    }

    setExecuting(false);
  };

  const handleRetryRequest = async (requestId: string) => {
    if (!settings.servicenow.apiKey) return;

    // Get fresh session data from the store to ensure we have latest responses
    const currentSession = getCurrentSession();
    if (!currentSession) return;

    const currentRequests = currentSession.requests;
    const request = currentRequests.find((r) => r.id === requestId);
    if (!request) return;

    setRetryingRequestId(requestId);

    // Before retrying, resolve any placeholder dependencies from already-successful requests
    // e.g., if retrying an expense_line that needs {{contract.sys_id}}, find the contract's sys_id
    const body = request.modifiedBody || request.body;
    const resolvedBody: Record<string, unknown> = { ...body };

    for (const [key, value] of Object.entries(resolvedBody)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        const placeholder = value.slice(2, -2);
        const [entityType, field] = placeholder.split('.');

        if (field === 'sys_id') {
          // Find a successful request of this entity type and extract its sys_id
          const successfulRequest = currentRequests.find(
            (r) => r.entityType === entityType && r.status === 'success' && r.response
          );

          if (successfulRequest?.response?.data) {
            const responseData = successfulRequest.response.data as { result?: { sys_id?: string } };
            const sysId = responseData?.result?.sys_id;
            if (sysId) {
              resolvedBody[key] = sysId;
              console.log(`Resolved ${placeholder} to ${sysId}`);
            }
          }
        }
      }
    }

    console.log('Retrying request with resolved body:', resolvedBody);

    setRequestStatus(currentSession.id, requestId, 'executing');

    const api = initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);

    try {
      const response = await api.executeRequest(
        request.method,
        request.url,
        request.headers,
        resolvedBody as Record<string, unknown>
      );

      const success = response.status >= 200 && response.status < 300;

      if (success) {
        const data = response.data as { result?: { sys_id?: string } };
        const sysId = data?.result?.sys_id;

        setRequestStatus(currentSession.id, requestId, 'success');
        // Store both the response AND the resolved body so UI shows resolved values
        updateRequest(currentSession.id, requestId, {
          response: response,
          modifiedBody: resolvedBody,
        });
        addAuditEntry(
          currentSession.id,
          'REQUEST_RETRY_SUCCESS',
          `Retry successful. sys_id: ${sysId || 'N/A'}`
        );
      } else {
        setRequestStatus(currentSession.id, requestId, 'failed');
        updateRequest(currentSession.id, requestId, { response: response });
        addAuditEntry(
          currentSession.id,
          'REQUEST_RETRY_FAILED',
          `Retry failed: ${response.error || response.statusText}`
        );
      }
    } catch (error) {
      const errorResponse = {
        status: 500,
        statusText: 'Internal Error',
        data: null,
        headers: {},
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      setRequestStatus(currentSession.id, requestId, 'failed');
      updateRequest(currentSession.id, requestId, { response: errorResponse });
      addAuditEntry(
        currentSession.id,
        'REQUEST_RETRY_FAILED',
        `Retry failed: ${errorResponse.error}`
      );
    }

    setRetryingRequestId(null);
  };

  const approvedCount = requests.filter((r) => r.status === 'approved').length;
  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  const handleApproveAll = () => {
    requests.forEach((r) => {
      if (r.status === 'pending') {
        setRequestStatus(session.id, r.id, 'approved');
      }
    });
  };

  const handleExecutePending = async () => {
    if (!settings.servicenow.apiKey) return;

    // Get fresh session data
    const currentSession = getCurrentSession();
    if (!currentSession) return;

    const currentRequests = currentSession.requests;
    const pendingRequests = currentRequests.filter((r) => r.status === 'pending');

    if (pendingRequests.length === 0) return;

    setExecuting(true);
    setValidationResults(null);

    const api = initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);

    // Track completed results for dependency resolution during execution
    const completedResults = new Map<string, string>(); // entityType -> sys_id

    // Pre-populate from already successful requests
    currentRequests.forEach((r) => {
      if (r.status === 'success' && r.response?.data) {
        const responseData = r.response.data as { result?: { sys_id?: string } };
        const sysId = responseData?.result?.sys_id;
        if (sysId) {
          completedResults.set(r.entityType, sysId);
        }
      }
    });

    // Execute with real-time dependency resolution
    for (const request of sortRequestsByDependency(pendingRequests)) {
      const body = request.modifiedBody || request.body;
      const resolvedBody: Record<string, unknown> = { ...body };

      for (const [key, value] of Object.entries(resolvedBody)) {
        if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
          const placeholder = value.slice(2, -2);
          const [entityType, field] = placeholder.split('.');

          if (field === 'sys_id') {
            const sysId = completedResults.get(entityType);
            if (sysId) {
              resolvedBody[key] = sysId;
              console.log(`Resolved ${placeholder} to ${sysId}`);
            }
          }
        }
      }

      setRequestStatus(currentSession.id, request.id, 'executing');

      try {
        const response = await api.executeRequest(
          request.method,
          request.url,
          request.headers,
          resolvedBody as Record<string, unknown>
        );

        const success = response.status >= 200 && response.status < 300;
        let sysId: string | undefined;

        if (success) {
          const data = response.data as { result?: { sys_id?: string } };
          sysId = data?.result?.sys_id;

          // Store for dependent requests
          if (sysId) {
            completedResults.set(request.entityType, sysId);
          }

          setRequestStatus(currentSession.id, request.id, 'success');
          // Store both the response AND the resolved body so UI shows resolved values
          updateRequest(currentSession.id, request.id, {
            response: response,
            modifiedBody: resolvedBody,
          });
          addAuditEntry(
            currentSession.id,
            'REQUEST_SUCCESS',
            `Request completed successfully. sys_id: ${sysId || 'N/A'}`
          );
        } else {
          setRequestStatus(currentSession.id, request.id, 'failed');
          updateRequest(currentSession.id, request.id, { response: response });
          addAuditEntry(
            currentSession.id,
            'REQUEST_FAILED',
            `Request failed: ${response.error || response.statusText}`
          );
          // Continue with other pending requests (stopOnError: false)
        }
      } catch (error) {
        const errorResponse = {
          status: 500,
          statusText: 'Internal Error',
          data: null,
          headers: {},
          error: error instanceof Error ? error.message : 'Unknown error',
        };

        setRequestStatus(currentSession.id, request.id, 'failed');
        updateRequest(currentSession.id, request.id, { response: errorResponse });
        addAuditEntry(
          currentSession.id,
          'REQUEST_FAILED',
          `Request failed: ${errorResponse.error}`
        );
        // Continue with other pending requests
      }
    }

    setExecuting(false);
  };

  const handleCompleteSession = () => {
    if (!session) return;

    // Mark session as completed
    updateSessionStatus(session.id, 'completed');
    addAuditEntry(session.id, 'SESSION_COMPLETED', 'Session marked as completed');

    // Clear current session
    setCurrentSession(null);

    // Navigate to document upload for new session
    navigate('/document');
  };

  const handleStartNewSession = () => {
    // Clear current session without marking as completed
    setCurrentSession(null);

    // Navigate to document upload
    navigate('/document');
  };

  const successCount = requests.filter((r) => r.status === 'success').length;
  const failedCount = requests.filter((r) => r.status === 'failed').length;
  const allComplete = requests.length > 0 && pendingCount === 0 && approvedCount === 0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <List className="w-8 h-8 text-gray-700" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Request Queue</h1>
            <p className="text-gray-500">
              Session: {session.fileName} • {requests.length} requests
              {successCount > 0 && <span className="text-green-600 ml-2">({successCount} successful)</span>}
              {failedCount > 0 && <span className="text-red-600 ml-2">({failedCount} failed)</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Session Management Buttons */}
          {allComplete && (
            <button
              onClick={handleCompleteSession}
              className="flex items-center gap-2 px-4 py-2 text-purple-700 bg-purple-100 rounded-lg hover:bg-purple-200 font-medium"
            >
              <Archive className="w-4 h-4" />
              Complete & Archive
            </button>
          )}

          <button
            onClick={handleStartNewSession}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            title="Start processing a new document"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>

          <div className="w-px h-6 bg-gray-300" />
          {pendingCount > 0 && (
            <>
              <button
                onClick={handleApproveAll}
                className="flex items-center gap-2 px-4 py-2 text-green-700 bg-green-100 rounded-lg hover:bg-green-200"
              >
                <Check className="w-4 h-4" />
                Approve All ({pendingCount})
              </button>

              <button
                onClick={handleExecutePending}
                disabled={executing || !settings.servicenow.apiKey}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg font-medium',
                  executing || !settings.servicenow.apiKey
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-orange-500 text-white hover:bg-orange-600'
                )}
              >
                <Play className="w-4 h-4" />
                Run Pending ({pendingCount})
              </button>
            </>
          )}

          <button
            onClick={handleDryRun}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            <Check className="w-4 h-4" />
            Dry Run
          </button>

          <button
            onClick={handleExecuteAll}
            disabled={executing || approvedCount === 0 || !settings.servicenow.apiKey}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg font-medium',
              executing || approvedCount === 0 || !settings.servicenow.apiKey
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            )}
          >
            {executing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Execute All ({approvedCount})
              </>
            )}
          </button>
        </div>
      </div>

      {/* Validation Results */}
      {validationResults !== null && (
        <div className="mb-4 p-4 bg-white rounded-lg border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-2">Validation Results</h3>
          {validationResults.length === 0 ? (
            <div className="flex items-center gap-2 text-yellow-600">
              <AlertCircle className="w-5 h-5" />
              <span>No requests to validate. Generate requests first.</span>
            </div>
          ) : validationResults.every((r) => r.valid) ? (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              <span>All requests passed validation</span>
            </div>
          ) : (
            <div className="space-y-2">
              {validationResults
                .filter((r) => !r.valid)
                .map((result) => {
                  const request = requests.find((r) => r.id === result.requestId);
                  return (
                    <div
                      key={result.requestId}
                      className="flex items-start gap-2 text-red-600"
                    >
                      <AlertCircle className="w-4 h-4 mt-0.5" />
                      <div>
                        <span className="font-medium">
                          {request?.entityType}:
                        </span>
                        <ul className="list-disc list-inside text-sm">
                          {result.errors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Request List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-gray-700">
              Execution Order
              <span className="text-sm font-normal text-gray-400 ml-2">
                (sorted by dependencies)
              </span>
            </h3>
            <ArrowUpDown className="w-4 h-4 text-gray-400" />
          </div>

          {sortedRequests.map((request, index) => (
            <div
              key={request.id}
              onClick={() => setSelectedRequestId(request.id)}
              className={clsx(
                'p-3 bg-white rounded-lg border cursor-pointer transition-colors',
                selectedRequestId === request.id
                  ? 'border-blue-500 ring-1 ring-blue-500'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400 w-6">{index + 1}.</span>
                  {statusIcons[request.status]}
                  <div>
                    <p className="font-medium text-gray-900 text-sm">
                      {request.method}{' '}
                      <span className="text-gray-500">
                        {TABLE_NAMES[request.entityType]}
                      </span>
                    </p>
                    <p className="text-xs text-gray-400">{request.entityType}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'px-2 py-0.5 text-xs rounded-full',
                      statusColors[request.status]
                    )}
                  >
                    {request.status}
                  </span>

                  {request.status === 'pending' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleApprove(request.id);
                      }}
                      className="p-1 text-green-600 hover:bg-green-50 rounded"
                      title="Approve"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}

                  {request.status === 'approved' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReject(request.id);
                      }}
                      className="p-1 text-yellow-600 hover:bg-yellow-50 rounded"
                      title="Unapprove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}

                  {request.status === 'failed' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetryRequest(request.id);
                      }}
                      disabled={retryingRequestId === request.id || executing}
                      className={clsx(
                        'p-1 rounded',
                        retryingRequestId === request.id || executing
                          ? 'text-gray-400 cursor-not-allowed'
                          : 'text-blue-600 hover:bg-blue-50'
                      )}
                      title="Retry"
                    >
                      {retryingRequestId === request.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                    </button>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(request.id);
                    }}
                    className="p-1 text-red-600 hover:bg-red-50 rounded"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {requests.length === 0 && (
            <div className="p-8 bg-white rounded-lg border border-gray-200 text-center">
              <p className="text-gray-500">No requests in queue</p>
            </div>
          )}
        </div>

        {/* Request Inspector */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-medium text-gray-900 mb-4">Request Inspector</h3>

          {selectedRequest ? (
            <div className="space-y-4">
              {/* URL */}
              <div>
                <label className="text-sm font-medium text-gray-500">URL</label>
                <p className="text-sm text-gray-700 font-mono break-all">
                  {selectedRequest.url}
                </p>
              </div>

              {/* Method */}
              <div>
                <label className="text-sm font-medium text-gray-500">Method</label>
                <p className="text-sm text-gray-700">{selectedRequest.method}</p>
              </div>

              {/* Body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-500">Body</label>
                  {editingBody !== selectedRequest.id ? (
                    <button
                      onClick={() => handleStartEdit(selectedRequest)}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                    >
                      <Edit2 className="w-3 h-3" />
                      Edit
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveEdit(selectedRequest.id)}
                        className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700"
                      >
                        <Check className="w-3 h-3" />
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-700"
                      >
                        <X className="w-3 h-3" />
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {editingBody === selectedRequest.id ? (
                  <textarea
                    value={editedBodyText}
                    onChange={(e) => setEditedBodyText(e.target.value)}
                    rows={12}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                    spellCheck={false}
                  />
                ) : (
                  <div className="bg-gray-900 rounded-lg overflow-hidden">
                    <div className="max-h-64 overflow-auto">
                      <SyntaxHighlighter
                        language="json"
                        style={atomOneDark}
                        customStyle={{
                          margin: 0,
                          padding: '0.75rem',
                          fontSize: '0.75rem',
                        }}
                      >
                        {JSON.stringify(
                          selectedRequest.modifiedBody || selectedRequest.body,
                          null,
                          2
                        )}
                      </SyntaxHighlighter>
                    </div>
                  </div>
                )}
              </div>

              {/* Response (if executed) */}
              {selectedRequest.response && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium text-gray-500">Response</label>
                    {selectedRequest.status === 'failed' && (
                      <button
                        onClick={() => handleRetryRequest(selectedRequest.id)}
                        disabled={retryingRequestId === selectedRequest.id || executing}
                        className={clsx(
                          'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded',
                          retryingRequestId === selectedRequest.id || executing
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        )}
                      >
                        {retryingRequestId === selectedRequest.id ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Retrying...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-3 h-3" />
                            Retry Request
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  <div
                    className={clsx(
                      'mt-1 p-2 rounded-lg',
                      selectedRequest.status === 'success'
                        ? 'bg-green-50'
                        : 'bg-red-50'
                    )}
                  >
                    <p className="text-sm font-medium">
                      {selectedRequest.response.status}{' '}
                      {selectedRequest.response.statusText}
                    </p>
                    {selectedRequest.response.error && (
                      <p className="text-sm text-red-600 mt-1">
                        {selectedRequest.response.error}
                      </p>
                    )}
                  </div>

                  {selectedRequest.response.data != null && (
                    <div className="bg-gray-900 rounded-lg overflow-hidden mt-2">
                      <div className="max-h-48 overflow-auto">
                        <SyntaxHighlighter
                          language="json"
                          style={atomOneDark}
                          customStyle={{
                            margin: 0,
                            padding: '0.75rem',
                            fontSize: '0.7rem',
                          }}
                        >
                          {String(JSON.stringify(selectedRequest.response.data, null, 2))}
                        </SyntaxHighlighter>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">
              Select a request to inspect its details
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
