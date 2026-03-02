import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getUser, clearAuth, isAdmin } from '../lib/auth'
import {
  LayoutDashboard,
  FileText,
  Calendar,
  MessageSquare,
  MessageCircle,
  Upload,
  Settings,
  Shield,
  LogOut,
  Menu,
  X,
  CheckSquare,
  ClipboardList,
  Network,
  UserSearch,
} from 'lucide-react'
import { useState } from 'react'

const NAV_ITEMS = [
  { path: '/dashboard', label: '数据看板', icon: LayoutDashboard },
  { path: '/import', label: '数据导入', icon: Upload },
  { path: '/documents', label: '文档', icon: FileText },
  { path: '/meetings', label: '会议', icon: Calendar },
  { path: '/messages', label: '聊天记录', icon: MessageSquare },
  { path: '/chat', label: '流光助手', icon: MessageCircle },
  { path: '/todos', label: '智能待办', icon: CheckSquare },
  { path: '/reports', label: '报告中心', icon: ClipboardList },
  { path: '/knowledge-graph', label: '知识图谱', icon: Network },
  { path: '/leadership-insight', label: '员工画像', icon: UserSearch },
]

const ADMIN_NAV = [
  { path: '/admin/etl', label: 'ETL 管理', icon: Settings },
  { path: '/admin/departments', label: '权限管理', icon: Shield },
]

export default function Layout() {
  const user = getUser()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const navItems = isAdmin(user) ? [...NAV_ITEMS, ...ADMIN_NAV] : NAV_ITEMS

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 h-16 px-6 border-b border-gray-200">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">LG</span>
          </div>
          <span className="text-lg font-semibold text-gray-800">流光平台</span>
          <button
            className="ml-auto lg:hidden text-gray-500"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6">
          <button
            className="lg:hidden text-gray-500"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.name}
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                <span className="text-indigo-700 text-sm font-medium">
                  {user?.name?.[0] || '?'}
                </span>
              </div>
            )}
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-gray-700">{user?.name}</p>
              <p className="text-xs text-gray-400">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="ml-2 p-2 text-gray-400 hover:text-red-500 transition-colors"
              title="退出登录"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
