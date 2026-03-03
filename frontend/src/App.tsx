import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import DataImport from './pages/DataImport'
import Documents from './pages/Documents'
import Meetings from './pages/Meetings'
import Messages from './pages/Messages'
import Chat from './pages/Chat'
import ETLAdmin from './pages/ETLAdmin'
import DepartmentAdmin from './pages/DepartmentAdmin'
import Todos from './pages/Todos'
import Reports from './pages/Reports'
import ReportDetail from './pages/ReportDetail'
import KnowledgeGraph from './pages/KnowledgeGraph'
import LeadershipInsight from './pages/LeadershipInsight'
import StructuredTables from './pages/StructuredTables'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/import" element={<DataImport />} />
            <Route path="/structured-tables" element={<StructuredTables />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/meetings" element={<Meetings />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/todos" element={<Todos />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:id" element={<ReportDetail />} />
            <Route path="/knowledge-graph" element={<KnowledgeGraph />} />
            <Route path="/leadership-insight" element={<LeadershipInsight />} />
            <Route path="/permissions" element={<DepartmentAdmin />} />
            <Route
              path="/admin/etl"
              element={
                <ProtectedRoute requiredRole="admin">
                  <ETLAdmin />
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: { fontSize: '14px' },
        }}
      />
    </QueryClientProvider>
  )
}
