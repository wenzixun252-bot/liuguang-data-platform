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
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import HeaderSearch from './HeaderSearch'
import PageTransition from './PageTransition'

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
  { path: '/data-import', label: '数据导入', icon: Upload },
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
  const [scrolled, setScrolled] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

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

  // 监听主内容区滚动，驱动顶栏模糊效果
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const handler = () => setScrolled(main.scrollTop > 10)
    main.addEventListener('scroll', handler)
    return () => main.removeEventListener('scroll', handler)
  }, [])

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
    <div className="flex h-screen" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-[272px] apple-glass-heavy border-r border-black/[0.04] transform transition-transform lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 h-16 px-7 border-b border-black/[0.04]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">LG</span>
          </div>
          <span className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)', letterSpacing: 'var(--tracking-tighter)' }}>
            流光平台
          </span>
          <button
            type="button"
            title="关闭菜单"
            className="ml-auto lg:hidden apple-btn rounded-lg p-1 hover:bg-black/[0.04]"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="p-5 space-y-1">
          {NAV_ITEMS.map((entry) => {
            if (isNavGroup(entry)) {
              const expanded = expandedGroups.has(entry.key)
              const groupActive = entry.children.some(c => location.pathname === c.path)
              const GroupIcon = entry.icon
              return (
                <div key={entry.key}>
                  <button
                    onClick={() => toggleGroup(entry.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors apple-btn ${
                      groupActive
                        ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-black/[0.04] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    <GroupIcon size={18} />
                    {entry.label}
                    <ChevronDown
                      size={14}
                      className="ml-auto"
                      style={{
                        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 250ms cubic-bezier(0.25, 0.1, 0.25, 1.0)',
                      }}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1.0] }}
                        className="ml-4 mt-0.5 space-y-0.5 overflow-hidden"
                      >
                        {entry.children.map(child => {
                          const ChildIcon = child.icon
                          const active = location.pathname === child.path
                          return (
                            <Link
                              key={child.path}
                              to={child.path}
                              onClick={() => setSidebarOpen(false)}
                              className={`flex items-center gap-3 px-3 py-2 rounded-[10px] text-sm transition-colors apple-btn ${
                                active
                                  ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-medium'
                                  : 'text-[var(--color-text-tertiary)] hover:bg-black/[0.04] hover:text-[var(--color-text-primary)]'
                              }`}
                            >
                              <ChildIcon size={16} />
                              {child.label}
                            </Link>
                          )
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
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
                className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors apple-btn ${
                  active
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-black/[0.04] hover:text-[var(--color-text-primary)]'
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
        <header
          className={`h-16 flex items-center justify-between px-4 lg:px-6 transition-all duration-300 ${
            scrolled
              ? 'apple-glass border-b border-black/[0.06]'
              : 'bg-transparent border-b border-transparent'
          }`}
          style={scrolled ? { boxShadow: 'var(--shadow-xs)' } : undefined}
        >
          <button
            type="button"
            title="打开菜单"
            className="lg:hidden apple-btn rounded-lg p-1.5 hover:bg-black/[0.04]"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>

          {/* 全局搜索触发器 */}
          <div className="flex-1 max-w-md mx-4">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center gap-2 px-3.5 py-2 bg-black/[0.04] hover:bg-black/[0.06] rounded-xl text-sm transition-all duration-200 border border-transparent hover:border-black/[0.04]"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <Search size={15} className="opacity-60" />
              <span>搜索文档、沟通记录...</span>
              <kbd className="ml-auto text-[11px] bg-black/[0.05] px-1.5 py-0.5 rounded-md font-medium"
                   style={{ color: 'var(--color-text-quaternary)' }}>
                Ctrl+K
              </kbd>
            </button>
          </div>

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-black/[0.04] transition-colors apple-btn"
            >
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.name}
                  className="w-8 h-8 rounded-full"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[var(--color-accent-light)] flex items-center justify-center">
                  <span className="text-[var(--color-accent)] text-sm font-medium">
                    {user?.name?.[0] || '?'}
                  </span>
                </div>
              )}
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{user?.name}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{user?.role}</p>
              </div>
              <ChevronDown size={14} style={{ color: 'var(--color-text-quaternary)' }} />
            </button>

            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: -2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="absolute right-0 top-full mt-2 w-52 apple-glass-heavy rounded-2xl py-1.5 z-50"
                  style={{ boxShadow: 'var(--shadow-float)' }}
                >
                  <Link
                    to="/settings"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-black/[0.04] apple-btn"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    <UserCog size={16} />
                    设置
                  </Link>
                  <div className="border-t border-black/[0.06] my-1.5 mx-3" />
                  <button
                    onClick={() => { setDropdownOpen(false); handleLogout() }}
                    className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors apple-btn"
                  >
                    <LogOut size={16} />
                    退出登录
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        {/* Page content */}
        <main ref={mainRef} className="flex-1 overflow-auto p-5 lg:p-8">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>

      {/* 全局搜索弹窗 */}
      <HeaderSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
