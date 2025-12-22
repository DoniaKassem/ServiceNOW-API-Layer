import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApprovalLevel, WorkflowConfig, RequestMethod } from '../types';

interface WorkflowState {
  workflows: WorkflowConfig[];
  countdownActive: boolean;
  countdownSeconds: number;
  pendingWorkflowId: string | null;

  // Workflow management
  getWorkflow: (method: RequestMethod, table: string) => WorkflowConfig | undefined;
  setApprovalLevel: (workflowId: string, level: ApprovalLevel) => void;
  recordExecution: (workflowId: string, success: boolean) => void;
  resetAllToManual: () => void;
  downgradeToManual: (workflowId: string) => void;

  // Countdown management
  startCountdown: (workflowId: string) => void;
  cancelCountdown: () => void;
  decrementCountdown: () => void;

  // Helpers
  shouldAutoExecute: (method: RequestMethod, table: string) => boolean;
  shouldShowCountdown: (method: RequestMethod, table: string) => boolean;
  canBeAutomated: (method: RequestMethod, isBulk: boolean, recordCount: number) => boolean;
}

// Initial workflow configurations
const initialWorkflows: WorkflowConfig[] = [
  // GET operations
  { id: 'get-contracts', name: 'Get Contracts', description: 'Fetch contract list', method: 'GET', table: 'ast_contract', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'get-purchase-orders', name: 'Get Purchase Orders', description: 'Fetch PO list', method: 'GET', table: 'sn_shop_purchase_order', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'get-suppliers', name: 'Get Suppliers', description: 'Fetch supplier list', method: 'GET', table: 'sn_fin_supplier', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'get-vendors', name: 'Get Vendors', description: 'Fetch vendor list', method: 'GET', table: 'core_company', approvalLevel: 'manual', successCount: 0, failureCount: 0 },

  // POST operations
  { id: 'create-vendor', name: 'Create Vendor', description: 'Create new vendor', method: 'POST', table: 'core_company', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'create-supplier', name: 'Create Supplier', description: 'Create new supplier', method: 'POST', table: 'sn_fin_supplier', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'create-contract', name: 'Create Contract', description: 'Create new contract', method: 'POST', table: 'ast_contract', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'create-purchase-order', name: 'Create Purchase Order', description: 'Create new PO', method: 'POST', table: 'sn_shop_purchase_order', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'create-expense-line', name: 'Create Expense Line', description: 'Create expense line', method: 'POST', table: 'fm_expense_line', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'create-po-line', name: 'Create PO Line', description: 'Create PO line item', method: 'POST', table: 'sn_shop_purchase_order_line', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'create-asset', name: 'Create Asset', description: 'Create new asset', method: 'POST', table: 'alm_asset', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'create-offering', name: 'Create Service Offering', description: 'Create service offering', method: 'POST', table: 'service_offering', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'create-currency', name: 'Create Currency Instance', description: 'Create currency instance', method: 'POST', table: 'fx_currency2_instance', approvalLevel: 'manual', successCount: 0, failureCount: 0 },

  // PATCH operations
  { id: 'update-vendor', name: 'Update Vendor', description: 'Update vendor record', method: 'PATCH', table: 'core_company', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'update-supplier', name: 'Update Supplier', description: 'Update supplier record', method: 'PATCH', table: 'sn_fin_supplier', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'update-contract', name: 'Update Contract', description: 'Update contract record', method: 'PATCH', table: 'ast_contract', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'update-purchase-order', name: 'Update Purchase Order', description: 'Update PO record', method: 'PATCH', table: 'sn_shop_purchase_order', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'update-expense-line', name: 'Update Expense Line', description: 'Update expense line', method: 'PATCH', table: 'fm_expense_line', approvalLevel: 'manual', successCount: 0, failureCount: 0 },

  // DELETE operations (can never be fully automated)
  { id: 'delete-vendor', name: 'Delete Vendor', description: 'Delete vendor record', method: 'DELETE', table: 'core_company', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'delete-supplier', name: 'Delete Supplier', description: 'Delete supplier record', method: 'DELETE', table: 'sn_fin_supplier', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'delete-contract', name: 'Delete Contract', description: 'Delete contract record', method: 'DELETE', table: 'ast_contract', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
  { id: 'delete-purchase-order', name: 'Delete Purchase Order', description: 'Delete PO record', method: 'DELETE', table: 'sn_shop_purchase_order', approvalLevel: 'manual', successCount: 0, failureCount: 0 },
];

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => ({
      workflows: initialWorkflows,
      countdownActive: false,
      countdownSeconds: 3,
      pendingWorkflowId: null,

      getWorkflow: (method, table) => {
        return get().workflows.find((w) => w.method === method && w.table === table);
      },

      setApprovalLevel: (workflowId, level) => {
        // DELETE operations can never be automated
        const workflow = get().workflows.find((w) => w.id === workflowId);
        if (workflow?.method === 'DELETE' && level === 'automated') {
          level = 'validated'; // Downgrade to validated
        }

        set((state) => ({
          workflows: state.workflows.map((w) =>
            w.id === workflowId ? { ...w, approvalLevel: level } : w
          ),
        }));
      },

      recordExecution: (workflowId, success) => {
        set((state) => ({
          workflows: state.workflows.map((w) =>
            w.id === workflowId
              ? {
                  ...w,
                  lastExecuted: new Date(),
                  successCount: success ? w.successCount + 1 : w.successCount,
                  failureCount: success ? w.failureCount : w.failureCount + 1,
                }
              : w
          ),
        }));

        // If failed and was automated, downgrade to manual
        if (!success) {
          const workflow = get().workflows.find((w) => w.id === workflowId);
          if (workflow?.approvalLevel === 'automated') {
            get().downgradeToManual(workflowId);
          }
        }
      },

      resetAllToManual: () => {
        set((state) => ({
          workflows: state.workflows.map((w) => ({
            ...w,
            approvalLevel: 'manual' as ApprovalLevel,
          })),
        }));
      },

      downgradeToManual: (workflowId) => {
        set((state) => ({
          workflows: state.workflows.map((w) =>
            w.id === workflowId ? { ...w, approvalLevel: 'manual' as ApprovalLevel } : w
          ),
        }));
      },

      startCountdown: (workflowId) => {
        set({
          countdownActive: true,
          countdownSeconds: 3,
          pendingWorkflowId: workflowId,
        });
      },

      cancelCountdown: () => {
        set({
          countdownActive: false,
          countdownSeconds: 3,
          pendingWorkflowId: null,
        });
      },

      decrementCountdown: () => {
        set((state) => ({
          countdownSeconds: state.countdownSeconds - 1,
        }));
      },

      shouldAutoExecute: (method, table) => {
        const workflow = get().getWorkflow(method, table);
        return workflow?.approvalLevel === 'automated';
      },

      shouldShowCountdown: (method, table) => {
        const workflow = get().getWorkflow(method, table);
        return workflow?.approvalLevel === 'validated';
      },

      canBeAutomated: (method, isBulk, recordCount) => {
        // DELETE operations can never be fully automated
        if (method === 'DELETE') return false;

        // Bulk operations (more than 5 records) require at least Validated level
        if (isBulk && recordCount > 5) return false;

        return true;
      },
    }),
    {
      name: 'servicenow-workflows',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const data = JSON.parse(str);
          // Rehydrate dates
          if (data.state?.workflows) {
            data.state.workflows = data.state.workflows.map((w: WorkflowConfig) => ({
              ...w,
              lastExecuted: w.lastExecuted ? new Date(w.lastExecuted) : undefined,
            }));
          }
          return data;
        },
        setItem: (name, value) => localStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
