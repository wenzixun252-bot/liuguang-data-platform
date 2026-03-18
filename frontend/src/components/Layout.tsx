import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getUser, clearAuth, isAdmin, getAdminMode, toggleAdminMode } from '../lib/auth'
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
  Shield,
  MessageCircleWarning,
  BookOpen,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import HeaderSearch from './HeaderSearch'
import TaskProgressPanel from './TaskProgressPanel'
import QuickStartGuide from './QuickStartGuide'
import PageTransition from './PageTransition'
import { useTaskProgress } from '../hooks/useTaskProgress'
import { useAutoSync } from '../hooks/useAutoSync'
import api from '../lib/api'

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
  { path: '/data-import', label: '数据归档', icon: Upload },
  {
    key: 'data-assets',
    label: '数据',
    icon: FolderOpen,
    children: [
      { path: '/communications', label: '沟通数据', icon: MessageSquare },
      { path: '/documents', label: '文档数据', icon: FileText },
      { path: '/structured-tables', label: '表格数据', icon: Table2 },
    ],
  },
  { path: '/chat', label: '智能助手', icon: Bot },
  { path: '/settings', label: '设置', icon: Settings },
]

export default function Layout() {
  const { tasks, addTask, updateTask } = useTaskProgress()
  useAutoSync()
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

  // 全局任务运行状态轮询
  const { data: syncStatusData } = useQuery({
    queryKey: ['sync-status'],
    queryFn: async () => { const res = await api.get('/import/sync-status'); return res.data },
    refetchInterval: 5000,
    staleTime: 2000,
  })
  const { data: cloudFoldersData } = useQuery({
    queryKey: ['cloud-folders-status'],
    queryFn: async () => { const res = await api.get('/import/cloud-folders'); return res.data },
    refetchInterval: 5000,
    staleTime: 2000,
  })
  const { data: todoExtractData } = useQuery({
    queryKey: ['todo-extract-status'],
    queryFn: async () => { const res = await api.get('/todos/extract-status'); return res.data },
    refetchInterval: 5000,
    staleTime: 2000,
  })
  const { data: kgStatusData } = useQuery({
    queryKey: ['kg-build-status'],
    queryFn: async () => { const res = await api.get('/knowledge-graph/build-status'); return res.data },
    refetchInterval: 5000,
    staleTime: 2000,
  })
  // 轮询正在生成的报告
  const { data: generatingReportsData } = useQuery({
    queryKey: ['reports-generating'],
    queryFn: async () => { const res = await api.get('/reports', { params: { status: 'generating', page_size: 10 } }); return res.data },
    refetchInterval: 5000,
    staleTime: 2000,
  })
  // 将后端轮询到的运行中任务自动同步到任务中心面板
  const syncSources = (syncStatusData as { id?: number; table_name?: string; asset_type?: string; last_sync_status?: string }[] | undefined) ?? []
  const runningSyncIds = syncSources.filter(s => s.last_sync_status === 'running').map(s => ({ id: s.id, table_name: s.table_name, asset_type: s.asset_type }))
  const cloudFolders = (cloudFoldersData as { id?: number; folder_name?: string; last_sync_status?: string }[] | undefined) ?? []
  const runningCloudFolderIds = cloudFolders.filter(f => f.last_sync_status === 'running').map(f => ({ id: f.id, folder_name: f.folder_name }))
  const kgRunning = kgStatusData?.status === 'running'
  const todoExtractRunning = (todoExtractData as { status?: string } | undefined)?.status === 'running'

  // 用 ref 跟踪上一次的后端状态，避免 useEffect 依赖 tasks 导致无限循环
  const prevSyncIdsRef = useRef<string>('')
  const prevCloudFolderIdsRef = useRef<string>('')
  const prevKgRunningRef = useRef<boolean | undefined>(undefined)
  const prevTodoExtractRunningRef = useRef<boolean | undefined>(undefined)
  const prevReportIdsRef = useRef<string>('')

  const syncIdsKey = runningSyncIds.map(s => s.id).join(',')
  useEffect(() => {
    if (syncIdsKey === prevSyncIdsRef.current) return
    const prevIds = new Set(prevSyncIdsRef.current.split(',').filter(Boolean))
    const curIds = new Set(syncIdsKey.split(',').filter(Boolean))
    // 新增的同步任务
    runningSyncIds.forEach(s => {
      const sid = String(s.id)
      if (!prevIds.has(sid)) {
        const typeLabel = s.asset_type === 'document' ? '文档' : s.asset_type === 'communication' ? '沟通记录' : s.asset_type === 'structured' ? '数据表' : '数据'
        const label = s.table_name ? `同步: ${s.table_name}` : `同步${typeLabel}`
        addTask(`sync-${s.id}`, label, '/data-import')
      }
    })
    // 已结束的同步任务
    prevIds.forEach(sid => {
      if (!curIds.has(sid)) {
        updateTask(`sync-${sid}`, { status: 'done', progress: 100, message: '已完成' })
      }
    })
    prevSyncIdsRef.current = syncIdsKey
  }, [syncIdsKey, runningSyncIds, addTask, updateTask])

  // 云文件夹同步状态跟踪
  const cloudFolderIdsKey = runningCloudFolderIds.map(f => f.id).join(',')
  useEffect(() => {
    if (cloudFolderIdsKey === prevCloudFolderIdsRef.current) return
    const prevIds = new Set(prevCloudFolderIdsRef.current.split(',').filter(Boolean))
    const curIds = new Set(cloudFolderIdsKey.split(',').filter(Boolean))
    // 新增的云文件夹同步任务
    runningCloudFolderIds.forEach(f => {
      const fid = String(f.id)
      if (!prevIds.has(fid)) {
        const label = f.folder_name ? `同步: ${f.folder_name}` : '云文件夹同步'
        addTask(`cloud-folder-${f.id}`, label, '/documents')
      }
    })
    // 已结束的云文件夹同步任务
    prevIds.forEach(fid => {
      if (!curIds.has(fid)) {
        updateTask(`cloud-folder-${fid}`, { status: 'done', progress: 100, message: '已完成' })
      }
    })
    prevCloudFolderIdsRef.current = cloudFolderIdsKey
  }, [cloudFolderIdsKey, runningCloudFolderIds, addTask, updateTask])

  useEffect(() => {
    if (kgRunning === prevKgRunningRef.current) return
    if (kgRunning) {
      // 使用与 KG 页面相同的任务 ID，addTask 内部会自动去重
      addTask('kg-build', '知识图谱生成', '/chat?tab=graph')
    } else if (prevKgRunningRef.current === true) {
      updateTask('kg-build', { status: 'done', progress: 100, message: '已完成' })
    }
    prevKgRunningRef.current = kgRunning
  }, [kgRunning, addTask, updateTask])

  // 待办提取状态跟踪
  useEffect(() => {
    if (todoExtractRunning === prevTodoExtractRunningRef.current) return
    if (todoExtractRunning) {
      addTask('todo-extract', '智能提取待办', '/chat?tab=todos')
    } else if (prevTodoExtractRunningRef.current === true) {
      updateTask('todo-extract', { status: 'done', progress: 100, message: '已完成' })
    }
    prevTodoExtractRunningRef.current = todoExtractRunning
  }, [todoExtractRunning, addTask, updateTask])

  // 同步报告生成状态到任务中心
  const generatingReports = (generatingReportsData as { items?: { id: number; title: string; status: string }[] } | undefined)?.items ?? []
  const generatingReportIdsKey = generatingReports.map(r => r.id).join(',')
  // 用 ref 保存最新的 generating ID set，给兜底 effect 使用（避免循环依赖）
  const generatingReportIdSetRef = useRef<Set<string>>(new Set())
  generatingReportIdSetRef.current = new Set(generatingReports.map(r => String(r.id)))
  useEffect(() => {
    if (generatingReportIdsKey === prevReportIdsRef.current) return
    const prevIds = new Set(prevReportIdsRef.current.split(',').filter(Boolean))
    const curIds = new Set(generatingReportIdsKey.split(',').filter(Boolean))
    // 新发现的正在生成的报告 — 如果任务中心还没有对应任务就添加
    generatingReports.forEach(r => {
      const rid = String(r.id)
      if (!prevIds.has(rid)) {
        addTask(`report-${r.id}`, `报告: ${r.title.slice(0, 15)}`, '/chat?tab=report')
      }
    })
    // 上次还在生成、现在不在列表里了 → 已完成
    prevIds.forEach(rid => {
      if (!curIds.has(rid)) {
        updateTask(`report-${rid}`, { status: 'done', progress: 100, message: '已完成' })
      }
    })
    prevReportIdsRef.current = generatingReportIdsKey
  }, [generatingReportIdsKey, generatingReports, addTask, updateTask])

  // 兜底：每次轮询到新的 generating 数据时，清理卡在 running 但后端已不在 generating 的 report 任务
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  useEffect(() => {
    const genIds = generatingReportIdSetRef.current
    tasksRef.current.forEach(t => {
      if (t.status === 'running' && t.id.startsWith('report-') && !t.id.startsWith('report-gen-')) {
        const rid = t.id.replace('report-', '')
        if (rid && !genIds.has(rid)) {
          updateTask(t.id, { status: 'done', progress: 100, message: '已完成' })
        }
      }
    })
  }, [generatingReportsData, updateTask])

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

          {/* 右侧功能区：帮助文档 + 快速开始 + 反馈 + 任务中心 + 用户头像 */}
          <div className="flex items-center gap-1.5 shrink-0">
          <a
            href="https://vzyjg03bu3.feishu.cn/docx/SEbmdTy3xoKgfDxkslVcn1XunEe"
            target="_blank"
            rel="noopener noreferrer"
            title="帮助文档"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium hover:bg-black/[0.04] transition-colors apple-btn"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <BookOpen size={18} />
            <span className="hidden sm:inline">帮助文档</span>
          </a>
          <QuickStartGuide />
          <a
            href="https://vzyjg03bu3.feishu.cn/base/ScGfb5sXFatp5IsHfKAcIBf8npd"
            target="_blank"
            rel="noopener noreferrer"
            title="问题反馈"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium hover:bg-black/[0.04] transition-colors apple-btn"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <MessageCircleWarning size={18} />
            <span className="hidden sm:inline">反馈</span>
          </a>

          {/* 全局任务中心（紧靠用户头像左侧） */}
          <TaskProgressPanel />

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
                <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {isAdmin(user) ? (getAdminMode() ? '管理模式' : '个人模式') : user?.role}
                </p>
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
                  {isAdmin(user) && (
                    <>
                      <div className="border-t border-black/[0.06] my-1.5 mx-3" />
                      <button
                        onClick={() => {
                          toggleAdminMode()
                          setDropdownOpen(false)
                          window.location.reload()
                        }}
                        className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm transition-colors hover:bg-black/[0.04] apple-btn"
                        style={{ color: getAdminMode() ? 'var(--color-text-primary)' : 'var(--color-accent)' }}
                      >
                        <Shield size={16} />
                        {getAdminMode() ? '切换为个人模式' : '切换为管理模式'}
                      </button>
                    </>
                  )}
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
