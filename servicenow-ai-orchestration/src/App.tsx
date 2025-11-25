import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/common/Layout';
import { Dashboard } from './components/Dashboard';
import { AnalyticsDashboard } from './components/dashboard';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { DocumentUpload } from './components/document/DocumentUpload';
import { RequestBuilder } from './components/request/RequestBuilder';
import { RequestQueue } from './components/request/RequestQueue';
import { ExtractionEditor } from './components/extraction/ExtractionEditor';
import { SessionHistory } from './components/SessionHistory';
import { TableViewPage } from './components/tables/TableViewPage';
import { WorkflowAutomation } from './components/settings/WorkflowAutomation';
import { RequestLogPanel } from './components/request-log/RequestLogPanel';
import { ToastProvider } from './components/ui';
import { useSessionStore } from './stores/sessionStore';
import { useRequestLogStore } from './stores/requestLogStore';

const queryClient = new QueryClient();

function DocumentProcessingPage() {
  const { getCurrentSession } = useSessionStore();
  const session = getCurrentSession();

  // If we have a session with extracted data, show the editor
  if (session?.extractedData) {
    return <ExtractionEditor />;
  }

  // Otherwise show the upload component
  return <DocumentUpload />;
}

function RequestConsolePage() {
  const { getCurrentSession } = useSessionStore();
  const session = getCurrentSession();

  // If we have a session with requests, show the queue
  if (session && session.requests.length > 0) {
    return <RequestQueue />;
  }

  // Otherwise show the manual request builder
  return <RequestBuilder />;
}

// Table View Pages
function ContractsPage() {
  return <TableViewPage viewType="contracts" />;
}

function PurchaseOrdersPage() {
  return <TableViewPage viewType="purchase_orders" />;
}

function SuppliersPage() {
  return <TableViewPage viewType="suppliers" />;
}

function VendorsPage() {
  return <TableViewPage viewType="vendors" />;
}

function App() {
  const { isPanelOpen, setIsPanelOpen } = useRequestLogStore();

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              {/* Dashboard */}
              <Route path="/" element={<Dashboard />} />

            {/* Analytics Dashboard */}
            <Route path="/analytics" element={<AnalyticsDashboard />} />

            {/* Document Processing */}
            <Route path="/document" element={<DocumentProcessingPage />} />

            {/* Request Console */}
            <Route path="/requests" element={<RequestConsolePage />} />

            {/* Table Views */}
            <Route path="/tables/contracts" element={<ContractsPage />} />
            <Route path="/tables/purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="/tables/suppliers" element={<SuppliersPage />} />
            <Route path="/tables/vendors" element={<VendorsPage />} />

            {/* History & Settings */}
            <Route path="/history" element={<SessionHistory />} />
            <Route path="/settings" element={<SettingsPanel />} />
            <Route path="/settings/workflows" element={<WorkflowAutomation />} />

            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          {/* Request Log Panel (global overlay) */}
          <RequestLogPanel
            isOpen={isPanelOpen}
            onClose={() => setIsPanelOpen(false)}
          />
        </Layout>
      </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
