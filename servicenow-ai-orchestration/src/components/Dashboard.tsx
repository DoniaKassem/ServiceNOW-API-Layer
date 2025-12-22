import React from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  Send,
  History,
  Settings,
  Upload,
  ArrowRight,
  CheckCircle,
  Clock,
  AlertTriangle,
  Server,
  Brain,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { format } from 'date-fns';

export function Dashboard() {
  const { sessions, setCurrentSession } = useSessionStore();
  const { settings } = useSettingsStore();

  const recentSessions = sessions.slice(0, 5);
  const totalRequests = sessions.reduce((acc, s) => acc + s.requests.length, 0);
  const successfulRequests = sessions.reduce(
    (acc, s) => acc + s.requests.filter((r) => r.status === 'success').length,
    0
  );

  const quickActions = [
    {
      icon: Upload,
      label: 'Upload Document',
      description: 'Process a new procurement document',
      path: '/document',
      color: 'bg-blue-500',
    },
    {
      icon: Send,
      label: 'Manual Request',
      description: 'Build and send custom API requests',
      path: '/requests',
      color: 'bg-green-500',
    },
    {
      icon: History,
      label: 'View History',
      description: 'Review past sessions and audit logs',
      path: '/history',
      color: 'bg-purple-500',
    },
    {
      icon: Settings,
      label: 'Settings',
      description: 'Configure connections and defaults',
      path: '/settings',
      color: 'bg-gray-500',
    },
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'in_progress':
        return <Clock className="w-4 h-4 text-blue-500" />;
      case 'failed':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Welcome to ServiceNow AI Orchestration</h1>
        <p className="text-gray-500 mt-2">
          Transform procurement documents into validated ServiceNow records
        </p>
      </div>

      {/* Connection Status Banner */}
      {!settings.servicenow.isConnected && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            <div>
              <p className="font-medium text-yellow-800">ServiceNow not connected</p>
              <p className="text-sm text-yellow-700">
                Configure your API key to enable document processing
              </p>
            </div>
          </div>
          <Link
            to="/settings"
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 text-sm font-medium"
          >
            Configure Now
          </Link>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{sessions.length}</p>
              <p className="text-sm text-gray-500">Total Sessions</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Send className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalRequests}</p>
              <p className="text-sm text-gray-500">Total Requests</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <CheckCircle className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{successfulRequests}</p>
              <p className="text-sm text-gray-500">Successful</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div
              className={clsx(
                'p-2 rounded-lg',
                settings.servicenow.isConnected ? 'bg-green-100' : 'bg-gray-100'
              )}
            >
              <Server
                className={clsx(
                  'w-5 h-5',
                  settings.servicenow.isConnected ? 'text-green-600' : 'text-gray-400'
                )}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {settings.servicenow.isConnected ? 'Connected' : 'Disconnected'}
              </p>
              <p className="text-xs text-gray-500 truncate max-w-[120px]">
                {settings.servicenow.instanceUrl.replace('https://', '')}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Quick Actions */}
        <div className="col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-4">
            {quickActions.map((action) => (
              <Link
                key={action.path}
                to={action.path}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all group"
              >
                <div className="flex items-start justify-between">
                  <div className={clsx('p-2 rounded-lg', action.color)}>
                    <action.icon className="w-5 h-5 text-white" />
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                </div>
                <h3 className="font-medium text-gray-900 mt-3">{action.label}</h3>
                <p className="text-sm text-gray-500 mt-1">{action.description}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Sessions */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Sessions</h2>
          <div className="bg-white rounded-lg border border-gray-200">
            {recentSessions.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {recentSessions.map((session) => (
                  <Link
                    key={session.id}
                    to="/requests"
                    onClick={() => setCurrentSession(session.id)}
                    className="block p-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(session.status)}
                        <span className="text-sm font-medium text-gray-900 truncate max-w-[150px]">
                          {session.fileName}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {session.requests.length} req
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {format(session.createdAt, 'MMM d, yyyy h:mm a')}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center">
                <FileText className="w-10 h-10 mx-auto text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">No sessions yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Upload a document to get started
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Workflow Overview */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">How It Works</h2>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="grid grid-cols-5 gap-4">
            {[
              {
                step: 1,
                icon: Upload,
                title: 'Upload',
                desc: 'Upload PDF, DOCX, or images',
              },
              {
                step: 2,
                icon: Brain,
                title: 'Extract',
                desc: 'AI extracts structured data',
              },
              {
                step: 3,
                icon: FileText,
                title: 'Review',
                desc: 'Edit and validate fields',
              },
              {
                step: 4,
                icon: Send,
                title: 'Generate',
                desc: 'Create API requests',
              },
              {
                step: 5,
                icon: CheckCircle,
                title: 'Execute',
                desc: 'Send to ServiceNow',
              },
            ].map((item, index) => (
              <React.Fragment key={item.step}>
                <div className="text-center">
                  <div className="flex items-center justify-center w-12 h-12 mx-auto bg-blue-100 rounded-full mb-3">
                    <item.icon className="w-6 h-6 text-blue-600" />
                  </div>
                  <p className="font-medium text-gray-900">{item.title}</p>
                  <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
                </div>
                {index < 4 && (
                  <div className="flex items-center justify-center pt-6">
                    <ArrowRight className="w-5 h-5 text-gray-300" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
