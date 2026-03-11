import { Component, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace' }}>
          <h2 style={{ color: 'red' }}>页面出错了</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button onClick={() => { this.setState({ error: null }); window.location.reload() }}
            style={{ marginTop: 16, padding: '8px 16px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            刷新页面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
import { TaskProgressProvider } from './hooks/useTaskProgress'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Documents from './pages/Documents'
import Communications from './pages/Communications'
import Chat from './pages/Chat'
import ReportDetail from './pages/ReportDetail'
import StructuredTables from './pages/StructuredTables'
import DataInsights from './pages/DataInsights'
import DataImport from './pages/DataImport'
import SearchPage from './pages/SearchPage'
import Settings from './pages/Settings'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

export default function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TaskProgressProvider>
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
            <Route path="/data-insights" element={<DataInsights />} />
            <Route path="/data-import" element={<DataImport />} />
            <Route path="/structured-tables" element={<StructuredTables />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/communications" element={<Communications />} />
            {/* 旧路由重定向 */}
            <Route path="/meetings" element={<Navigate to="/communications?comm_type=meeting" replace />} />
            <Route path="/messages" element={<Navigate to="/communications?comm_type=chat" replace />} />
            <Route path="/calendar" element={<Navigate to="/chat?tab=calendar" replace />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/reports" element={<Navigate to="/chat" replace />} />
            <Route path="/reports/:id" element={<ReportDetail />} />
            {/* 整合后的重定向路由 */}
            <Route path="/todos" element={<Navigate to="/chat?tab=todos" replace />} />
            <Route path="/knowledge-graph" element={<Navigate to="/chat?tab=graph" replace />} />
            <Route path="/leadership-insight" element={<Navigate to="/chat?tab=graph" replace />} />
            <Route path="/permissions" element={<Navigate to="/settings?tab=permissions" replace />} />
            <Route path="/admin/etl" element={<Navigate to="/settings?tab=etl" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/data-insights" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            fontSize: '14px',
            fontFamily: 'var(--font-sans)',
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.5)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.03)',
            borderRadius: '14px',
            padding: '12px 16px',
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.022em',
          },
        }}
      />
    </TaskProgressProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  )
}
