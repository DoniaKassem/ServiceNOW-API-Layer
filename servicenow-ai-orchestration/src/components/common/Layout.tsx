import React, { useState } from 'react';
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
  ScrollText,
  ShoppingCart,
  Users,
  Building2,
  ChevronDown,
  ChevronRight,
  Activity,
  Table,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { clsx } from 'clsx';

interface LayoutProps {
  children: React.ReactNode;
}

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  children?: NavItem[];
}

const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: Home },
  { path: '/document', label: 'Document Processing', icon: FileText },
  { path: '/requests', label: 'Request Console', icon: Send },
  {
    path: '/tables',
    label: 'Record Views',
    icon: Table,
    children: [
      { path: '/tables/contracts', label: 'Contracts', icon: ScrollText },
      { path: '/tables/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart },
      { path: '/tables/suppliers', label: 'Suppliers', icon: Users },
      { path: '/tables/vendors', label: 'Vendors', icon: Building2 },
    ],
  },
  { path: '/history', label: 'Session History', icon: History },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { settings } = useSettingsStore();
  const { entries, togglePanel, isPanelOpen } = useRequestLogStore();
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['/tables']);

  const toggleGroup = (path: string) => {
    setExpandedGroups((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const isPathActive = (path: string, children?: NavItem[]) => {
    if (children) {
      return children.some((child) => location.pathname === child.path);
    }
    return location.pathname === path;
  };

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

  const recentRequestCount = entries.filter(
    (e) => Date.now() - new Date(e.timestamp).getTime() < 60000
  ).length;

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
        <nav className="flex-1 p-4 overflow-y-auto">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = isPathActive(item.path, item.children);
              const isExpanded = expandedGroups.includes(item.path);
              const hasChildren = item.children && item.children.length > 0;

              return (
                <li key={item.path}>
                  {hasChildren ? (
                    <>
                      <button
                        onClick={() => toggleGroup(item.path)}
                        className={clsx(
                          'w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-gray-700 hover:bg-gray-100'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Icon className="w-5 h-5" />
                          {item.label}
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>

                      {isExpanded && (
                        <ul className="mt-1 ml-4 pl-4 border-l border-gray-200 space-y-1">
                          {item.children?.map((child) => {
                            const ChildIcon = child.icon;
                            const isChildActive = location.pathname === child.path;

                            return (
                              <li key={child.path}>
                                <Link
                                  to={child.path}
                                  className={clsx(
                                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                                    isChildActive
                                      ? 'bg-blue-50 text-blue-700 font-medium'
                                      : 'text-gray-600 hover:bg-gray-100'
                                  )}
                                >
                                  <ChildIcon className="w-4 h-4" />
                                  {child.label}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  ) : (
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
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Request Log Toggle */}
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={togglePanel}
            className={clsx(
              'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              isPanelOpen
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            )}
          >
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              <span>Request Log</span>
            </div>
            {entries.length > 0 && (
              <span className={clsx(
                'px-2 py-0.5 text-xs rounded-full',
                recentRequestCount > 0
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-600'
              )}>
                {entries.length}
              </span>
            )}
          </button>
        </div>

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
