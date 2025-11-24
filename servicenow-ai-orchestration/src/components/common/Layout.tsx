import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Settings,
  FileText,
  Send,
  History,
  Home,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { clsx } from 'clsx';

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: '/', label: 'Dashboard', icon: Home },
  { path: '/document', label: 'Document Processing', icon: FileText },
  { path: '/requests', label: 'Request Console', icon: Send },
  { path: '/history', label: 'Session History', icon: History },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { settings } = useSettingsStore();

  const ConnectionStatus = () => {
    if (settings.servicenow.isConnected) {
      return (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <CheckCircle className="w-4 h-4" />
          <span>Connected</span>
        </div>
      );
    }
    if (settings.servicenow.apiKey) {
      return (
        <div className="flex items-center gap-2 text-yellow-600 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Testing...</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 text-red-600 text-sm">
        <XCircle className="w-4 h-4" />
        <span>Not Connected</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">
            ServiceNow AI
          </h1>
          <p className="text-sm text-gray-500">
            Orchestration Platform
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={clsx(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Connection Status */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">ServiceNow</span>
            <ConnectionStatus />
          </div>
          {settings.servicenow.instanceUrl && (
            <p className="text-xs text-gray-400 mt-1 truncate">
              {settings.servicenow.instanceUrl.replace('https://', '')}
            </p>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
