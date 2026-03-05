import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Documents from './pages/Documents'
import Meetings from './pages/Meetings'
import Messages from './pages/Messages'
import Chat from './pages/Chat'
import ReportDetail from './pages/ReportDetail'
import StructuredTables from './pages/StructuredTables'
import DataInsights from './pages/DataInsights'
import SearchPage from './pages/SearchPage'
import Settings from './pages/Settings'

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
            <Route path="/data-insights" element={<DataInsights />} />
            <Route path="/structured-tables" element={<StructuredTables />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/meetings" element={<Meetings />} />
            <Route path="/messages" element={<Messages />} />
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
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: { fontSize: '14px' },
        }}
      />
    </QueryClientProvider>
  )
}
