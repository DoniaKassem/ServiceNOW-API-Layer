import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History,
  FileText,
  Trash2,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Clock,
  AlertTriangle,
  Download,
  Play,
} from 'lucide-react';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { useSessionStore } from '../stores/sessionStore';
import type { IngestionSession } from '../types';

export function SessionHistory() {
  const { sessions, deleteSession, setCurrentSession, updateSessionStatus } = useSessionStore();
  const navigate = useNavigate();
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'requests' | 'audit'>('requests');

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'in_progress':
        return <Clock className="w-5 h-5 text-blue-500" />;
      case 'failed':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'in_progress':
        return 'bg-blue-100 text-blue-700';
      case 'failed':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const handleDelete = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this session?')) {
      deleteSession(sessionId);
    }
  };

  const handleResumeSession = (session: IngestionSession, e: React.MouseEvent) => {
    e.stopPropagation();

    // If session was completed, mark it as in_progress again
    if (session.status === 'completed') {
      updateSessionStatus(session.id, 'in_progress');
    }

    // Set as current session
    setCurrentSession(session.id);

    // Navigate to request queue
    navigate('/requests');
  };

  const handleExport = (session: IngestionSession) => {
    const exportData = {
      session: {
        id: session.id,
        fileName: session.fileName,
        documentType: session.documentType,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      extractedData: session.extractedData,
      requests: session.requests.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        method: r.method,
        url: r.url,
        body: r.modifiedBody || r.body,
        status: r.status,
        response: r.response,
      })),
      auditLog: session.auditLog,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${session.id}-${format(session.createdAt, 'yyyy-MM-dd')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <History className="w-8 h-8 text-gray-700" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Session History</h1>
          <p className="text-gray-500">Review past sessions and audit logs</p>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <History className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg">No sessions yet</p>
          <p className="text-gray-400 mt-2">
            Upload a document to create your first session
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="bg-white rounded-lg border border-gray-200 overflow-hidden"
            >
              {/* Session Header */}
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() =>
                  setExpandedSession(
                    expandedSession === session.id ? null : session.id
                  )
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {expandedSession === session.id ? (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    )}
                    {getStatusIcon(session.status)}
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {session.fileName}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {format(session.createdAt, 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span
                        className={clsx(
                          'px-2 py-1 text-xs rounded-full',
                          getStatusColor(session.status)
                        )}
                      >
                        {session.status.replace('_', ' ')}
                      </span>
                      {session.documentType && (
                        <p className="text-xs text-gray-400 mt-1 capitalize">
                          {session.documentType.replace('_', ' ')}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => handleResumeSession(session, e)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg"
                        title="Resume session"
                      >
                        <Play className="w-3 h-3" />
                        Resume
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExport(session);
                        }}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                        title="Export session"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(session.id, e)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Delete session"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Stats Row */}
                <div className="flex items-center gap-6 mt-3 ml-9">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <FileText className="w-4 h-4" />
                    <span>
                      {session.requests.length} requests
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span>
                      {session.requests.filter((r) => r.status === 'success').length}{' '}
                      successful
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span>
                      {session.requests.filter((r) => r.status === 'failed').length}{' '}
                      failed
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              {expandedSession === session.id && (
                <div className="border-t border-gray-200">
                  {/* Tabs */}
                  <div className="flex border-b border-gray-200">
                    <button
                      onClick={() => setSelectedTab('requests')}
                      className={clsx(
                        'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
                        selectedTab === 'requests'
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      )}
                    >
                      Requests ({session.requests.length})
                    </button>
                    <button
                      onClick={() => setSelectedTab('audit')}
                      className={clsx(
                        'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
                        selectedTab === 'audit'
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      )}
                    >
                      Audit Log ({session.auditLog.length})
                    </button>
                  </div>

                  {/* Tab Content */}
                  <div className="p-4">
                    {selectedTab === 'requests' && (
                      <div className="space-y-2">
                        {session.requests.length === 0 ? (
                          <p className="text-gray-500 text-sm">No requests</p>
                        ) : (
                          session.requests.map((request) => (
                            <div
                              key={request.id}
                              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  className={clsx(
                                    'px-2 py-0.5 text-xs font-medium rounded',
                                    request.method === 'GET'
                                      ? 'bg-green-100 text-green-700'
                                      : request.method === 'POST'
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-yellow-100 text-yellow-700'
                                  )}
                                >
                                  {request.method}
                                </span>
                                <span className="text-sm text-gray-900">
                                  {request.entityType}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span
                                  className={clsx(
                                    'px-2 py-0.5 text-xs rounded-full',
                                    request.status === 'success'
                                      ? 'bg-green-100 text-green-700'
                                      : request.status === 'failed'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-gray-100 text-gray-700'
                                  )}
                                >
                                  {request.status}
                                </span>
                                {request.executedAt && (
                                  <span className="text-xs text-gray-400">
                                    {format(request.executedAt, 'h:mm:ss a')}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {selectedTab === 'audit' && (
                      <div className="space-y-2">
                        {session.auditLog.length === 0 ? (
                          <p className="text-gray-500 text-sm">No audit entries</p>
                        ) : (
                          session.auditLog.map((entry) => (
                            <div
                              key={entry.id}
                              className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
                            >
                              <div className="text-xs text-gray-400 whitespace-nowrap">
                                {format(entry.timestamp, 'h:mm:ss a')}
                              </div>
                              <div className="flex-1">
                                <span
                                  className={clsx(
                                    'text-xs font-medium px-2 py-0.5 rounded',
                                    entry.action.includes('SUCCESS')
                                      ? 'bg-green-100 text-green-700'
                                      : entry.action.includes('FAILED') ||
                                        entry.action.includes('ERROR')
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-gray-100 text-gray-700'
                                  )}
                                >
                                  {entry.action}
                                </span>
                                <p className="text-sm text-gray-600 mt-1">
                                  {entry.details}
                                </p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
