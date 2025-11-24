import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/common/Layout';
import { Dashboard } from './components/Dashboard';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { DocumentUpload } from './components/document/DocumentUpload';
import { RequestBuilder } from './components/request/RequestBuilder';
import { RequestQueue } from './components/request/RequestQueue';
import { ExtractionEditor } from './components/extraction/ExtractionEditor';
import { SessionHistory } from './components/SessionHistory';
import { useSessionStore } from './stores/sessionStore';

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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/document" element={<DocumentProcessingPage />} />
            <Route path="/requests" element={<RequestConsolePage />} />
            <Route path="/history" element={<SessionHistory />} />
            <Route path="/settings" element={<SettingsPanel />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
