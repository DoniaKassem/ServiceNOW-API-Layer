import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Shield,
  Clock,
  Zap,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { ApprovalLevel, WorkflowConfig } from '../../types';

export function WorkflowAutomation() {
  const {
    workflows,
    setApprovalLevel,
    resetAllToManual,
  } = useWorkflowStore();

  const groupedWorkflows = React.useMemo(() => {
    const groups: Record<string, WorkflowConfig[]> = {
      GET: [],
      POST: [],
      PATCH: [],
      DELETE: [],
    };

    for (const workflow of workflows) {
      groups[workflow.method].push(workflow);
    }

    return groups;
  }, [workflows]);

  const getApprovalIcon = (level: ApprovalLevel) => {
    switch (level) {
      case 'manual':
        return <Shield className="w-4 h-4 text-gray-500" />;
      case 'validated':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'automated':
        return <Zap className="w-4 h-4 text-green-500" />;
    }
  };

  const getApprovalLabel = (level: ApprovalLevel) => {
    switch (level) {
      case 'manual':
        return 'Manual';
      case 'validated':
        return 'Validated';
      case 'automated':
        return 'Automated';
    }
  };

  const getApprovalColor = (level: ApprovalLevel) => {
    switch (level) {
      case 'manual':
        return 'bg-gray-100 text-gray-700';
      case 'validated':
        return 'bg-yellow-100 text-yellow-700';
      case 'automated':
        return 'bg-green-100 text-green-700';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <Link
            to="/settings"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Settings
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Workflow Automation</h1>
              <p className="text-sm text-gray-500 mt-1">
                Configure approval levels for different operations
              </p>
            </div>
            <button
              onClick={resetAllToManual}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Reset All to Manual
            </button>
          </div>
        </div>

        {/* Approval Level Explanation */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <h3 className="font-medium text-gray-900 mb-3">Approval Levels</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Shield className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900">Manual</h4>
                <p className="text-sm text-gray-500">
                  Every request requires explicit approval before execution
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="w-5 h-5 text-yellow-500" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900">Validated</h4>
                <p className="text-sm text-gray-500">
                  Auto-executes after 3-second countdown. Cancel anytime.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Zap className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900">Automated</h4>
                <p className="text-sm text-gray-500">
                  Executes immediately. Results logged for review.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Safeguards Notice */}
        <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg mb-6">
          <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-700">Safety Safeguards</p>
            <ul className="text-sm text-yellow-600 mt-1 list-disc list-inside">
              <li>DELETE operations can never be fully automated</li>
              <li>Bulk operations (5+ records) require at least Validated level</li>
              <li>Failed automated requests automatically downgrade to Manual</li>
            </ul>
          </div>
        </div>

        {/* Workflow Groups */}
        {Object.entries(groupedWorkflows).map(([method, methodWorkflows]) => (
          <div key={method} className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-3 flex items-center gap-2">
              <span
                className={clsx(
                  'px-2 py-0.5 text-xs font-medium rounded',
                  method === 'GET' && 'bg-blue-100 text-blue-700',
                  method === 'POST' && 'bg-green-100 text-green-700',
                  method === 'PATCH' && 'bg-yellow-100 text-yellow-700',
                  method === 'DELETE' && 'bg-red-100 text-red-700'
                )}
              >
                {method}
              </span>
              Operations
            </h3>

            <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
              {methodWorkflows.map((workflow) => (
                <div
                  key={workflow.id}
                  className="flex items-center justify-between p-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{workflow.name}</span>
                      {workflow.method === 'DELETE' && (
                        <span className="px-1.5 py-0.5 text-xs bg-red-100 text-red-600 rounded">
                          No Auto
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{workflow.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span>Table: {workflow.table}</span>
                      {workflow.lastExecuted && (
                        <span>
                          Last run: {format(new Date(workflow.lastExecuted), 'MMM d, HH:mm')}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        {workflow.successCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <XCircle className="w-3 h-3 text-red-500" />
                        {workflow.failureCount}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {(['manual', 'validated', 'automated'] as ApprovalLevel[]).map((level) => {
                      const isDisabled = workflow.method === 'DELETE' && level === 'automated';
                      const isActive = workflow.approvalLevel === level;

                      return (
                        <button
                          key={level}
                          onClick={() => !isDisabled && setApprovalLevel(workflow.id, level)}
                          disabled={isDisabled}
                          className={clsx(
                            'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors',
                            isActive
                              ? getApprovalColor(level)
                              : 'text-gray-500 hover:bg-gray-100',
                            isDisabled && 'opacity-50 cursor-not-allowed'
                          )}
                          title={isDisabled ? 'DELETE operations cannot be automated' : undefined}
                        >
                          {getApprovalIcon(level)}
                          {getApprovalLabel(level)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
