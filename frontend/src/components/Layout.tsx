import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getUser, clearAuth } from '../lib/auth'
import {
  FileText,
  MessageSquare,
  Table2,
  Settings,
  LogOut,
  Menu,
  X,
  Telescope,
  Search,
  Bot,
  UserCog,
  ChevronDown,
  FolderOpen,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import HeaderSearch from './HeaderSearch'

// ── 导航类型 ──────────────────────────────────────────
interface NavItem {
  path: string
  label: string
  icon: LucideIcon
}

interface NavGroup {
  key: string
  label: string
  icon: LucideIcon
  children: NavItem[]
}

type NavEntry = NavItem | NavGroup

function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry
}

// ── 导航配置 ──────────────────────────────────────────
const NAV_ITEMS: NavEntry[] = [
  { path: '/data-insights', label: '数据洞察', icon: Telescope },
  {
    key: 'data-assets',
    label: '数据资产',
    icon: FolderOpen,
    children: [
      { path: '/communications', label: '沟通资产', icon: MessageSquare },
      { path: '/documents', label: '知识库', icon: FileText },
      { path: '/structured-tables', label: '业务数仓', icon: Table2 },
    ],
  },
  { path: '/chat', label: '智能助手', icon: Bot },
  { path: '/settings', label: '设置', icon: Settings },
]

export default function Layout() {
  const user = getUser()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['data-assets']))

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Ctrl+K / Cmd+K 快捷键打开搜索
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  // 当前路径匹配某个折叠组时自动展开
  useEffect(() => {
    for (const entry of NAV_ITEMS) {
      if (isNavGroup(entry)) {
        if (entry.children.some(child => location.pathname === child.path)) {
          setExpandedGroups(prev => {
            if (prev.has(entry.key)) return prev
            return new Set(prev).add(entry.key)
          })
        }
      }
    }
  }, [location.pathname])

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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
          {NAV_ITEMS.map((entry) => {
            if (isNavGroup(entry)) {
              const expanded = expandedGroups.has(entry.key)
              const groupActive = entry.children.some(c => location.pathname === c.path)
              const GroupIcon = entry.icon
              return (
                <div key={entry.key}>
                  <button
                    onClick={() => toggleGroup(entry.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      groupActive
                        ? 'bg-indigo-50/60 text-indigo-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    <GroupIcon size={18} />
                    {entry.label}
                    <ChevronDown
                      size={14}
                      className={`ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {expanded && (
                    <div className="ml-4 mt-0.5 space-y-0.5">
                      {entry.children.map(child => {
                        const ChildIcon = child.icon
                        const active = location.pathname === child.path
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                              active
                                ? 'bg-indigo-50 text-indigo-700 font-medium'
                                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                            }`}
                          >
                            <ChildIcon size={16} />
                            {child.label}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            }

            // 普通菜单项
            const Icon = entry.icon
            const active = location.pathname === entry.path
            return (
              <Link
                key={entry.path}
                to={entry.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon size={18} />
                {entry.label}
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

          {/* 全局搜索触发器 */}
          <div className="flex-1 max-w-md mx-4">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-400 transition-colors"
            >
              <Search size={16} />
              <span>搜索文档、沟通记录...</span>
              <kbd className="ml-auto text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded">Ctrl+K</kbd>
            </button>
          </div>

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
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
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-gray-700">{user?.name}</p>
                <p className="text-xs text-gray-400">{user?.role}</p>
              </div>
              <ChevronDown size={14} className="text-gray-400" />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                <Link
                  to="/settings"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <UserCog size={16} />
                  设置
                </Link>
                <div className="border-t border-gray-100 my-1" />
                <button
                  onClick={() => { setDropdownOpen(false); handleLogout() }}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut size={16} />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      {/* 全局搜索弹窗 */}
      <HeaderSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
