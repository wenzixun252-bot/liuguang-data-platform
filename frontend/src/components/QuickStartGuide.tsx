import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  Lock,
  ChevronRight,
  Sparkles,
  X,
  Tags,
  DatabaseZap,
  Bot,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useQuickStart } from '../hooks/useQuickStart'

const STEPS = [
  {
    title: '设置标签分类',
    desc: '创建至少 5 个标签，用于数据分类和检索',
    icon: Tags,
    path: '/settings?tab=tags',
  },
  {
    title: '配置数据源',
    desc: '配置飞书多维表格同步或云文件夹数据源',
    icon: DatabaseZap,
    path: '/data-import',
  },
  {
    title: '体验智能助手',
    desc: '试试智能问答、待办提取、知识图谱等 AI 功能',
    icon: Bot,
    path: '/chat',
  },
]

export default function QuickStartGuide() {
  const navigate = useNavigate()
  const { steps, completedCount, allDone, isFirstVisit, dismiss, refetchAll } = useQuickStart()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasAutoOpened = useRef(false)

  // 首次登录延迟 1 秒自动打开
  useEffect(() => {
    if (isFirstVisit && !hasAutoOpened.current) {
      hasAutoOpened.current = true
      const timer = setTimeout(() => setOpen(true), 1000)
      return () => clearTimeout(timer)
    }
  }, [isFirstVisit])

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleStepClick = (index: number) => {
    // 锁定状态：前一步未完成
    if (index > 0 && !steps[index - 1].done) return
    navigate(STEPS[index].path)
    setOpen(false)
    // 导航后延迟刷新状态
    setTimeout(refetchAll, 2000)
  }

  const getStepStatus = (index: number): 'done' | 'current' | 'locked' => {
    if (steps[index].done) return 'done'
    if (index === 0 || steps[index - 1].done) return 'current'
    return 'locked'
  }

  const buttonRef = useRef<HTMLButtonElement>(null)
  const [panelPos, setPanelPos] = useState({ top: 0, right: 0 })

  // 计算面板位置
  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPanelPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      })
    }
  }, [open])

  return (
    <div className="relative shrink-0" ref={containerRef}>
      {/* 触发按钮 */}
      <button
        ref={buttonRef}
        onClick={() => {
          setOpen(prev => !prev)
          if (!open) refetchAll()
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium hover:bg-black/[0.04] transition-colors apple-btn relative"
        style={{ color: 'var(--color-text-secondary)' }}
        title="快速开始"
      >
        <Sparkles size={18} />
        <span className="hidden sm:inline">快速开始</span>
        {/* 首次访问脉冲圆点 */}
        {isFirstVisit && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500" />
          </span>
        )}
      </button>

      {/* Popover 浮动面板 - fixed 定位避免遮挡页面内容 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="fixed w-80 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-[9999]"
            style={{ top: panelPos.top, right: panelPos.right }}
          >
            {/* 头部 */}
            <div className="px-4 pt-4 pb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <Sparkles size={14} className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    快速开始
                  </h3>
                  <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    {allDone ? '全部完成' : `${completedCount}/3 步已完成`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => refetchAll()}
                  className="p-1 rounded-lg hover:bg-black/[0.04] transition-colors"
                  style={{ color: 'var(--color-text-quaternary)' }}
                  title="刷新状态"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 rounded-lg hover:bg-black/[0.04] transition-colors"
                  style={{ color: 'var(--color-text-quaternary)' }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* 进度条 */}
            <div className="px-4 pb-3">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                  style={{ width: `${(completedCount / 3) * 100}%` }}
                />
              </div>
            </div>

            {/* 步骤卡片 */}
            <div className="px-3 pb-2">
              {STEPS.map((stepConfig, index) => {
                const status = getStepStatus(index)
                const isLoading = steps[index].loading
                const StepIcon = stepConfig.icon
                const isClickable = status !== 'locked'

                return (
                  <button
                    key={index}
                    onClick={() => handleStepClick(index)}
                    disabled={!isClickable}
                    className={`w-full text-left px-3 py-3 rounded-lg mb-1.5 last:mb-0 flex items-center gap-3 transition-all duration-200 ${
                      status === 'done'
                        ? 'bg-emerald-50/60 hover:bg-emerald-50'
                        : status === 'current'
                        ? 'bg-indigo-50/60 hover:bg-indigo-50 ring-1 ring-indigo-200'
                        : 'bg-gray-50/60 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    {/* 序号/状态圆圈 */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        status === 'done'
                          ? 'bg-emerald-500'
                          : status === 'current'
                          ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
                          : 'bg-gray-300'
                      }`}
                    >
                      {isLoading ? (
                        <Loader2 size={14} className="text-white animate-spin" />
                      ) : status === 'done' ? (
                        <Check size={14} className="text-white" strokeWidth={3} />
                      ) : status === 'locked' ? (
                        <Lock size={12} className="text-white" />
                      ) : (
                        <StepIcon size={14} className="text-white" />
                      )}
                    </div>

                    {/* 文字区域 */}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium ${
                          status === 'done' ? 'text-emerald-700' : status === 'current' ? 'text-indigo-700' : ''
                        }`}
                        style={status === 'locked' ? { color: 'var(--color-text-tertiary)' } : status !== 'done' && status !== 'current' ? { color: 'var(--color-text-primary)' } : undefined}
                      >
                        {stepConfig.title}
                      </p>
                      <p
                        className="text-xs mt-0.5 line-clamp-1"
                        style={{ color: 'var(--color-text-tertiary)' }}
                      >
                        {stepConfig.desc}
                      </p>
                    </div>

                    {/* 右侧图标 */}
                    <div className="shrink-0">
                      {status === 'done' ? (
                        <span className="text-[10px] font-medium text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                          已完成
                        </span>
                      ) : status === 'current' ? (
                        <ChevronRight size={16} className="text-indigo-400" />
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* 全部完成庆祝 */}
            {allDone && (
              <div className="px-4 py-3 border-t border-gray-100 text-center">
                <p className="text-sm font-medium bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  开始体验流光数据平台吧
                </p>
              </div>
            )}

            {/* 底部：不再提示 */}
            {isFirstVisit && !allDone && (
              <div className="px-4 py-2.5 border-t border-gray-100">
                <button
                  onClick={() => {
                    dismiss()
                    setOpen(false)
                  }}
                  className="text-xs w-full text-center py-1 rounded-lg hover:bg-black/[0.04] transition-colors"
                  style={{ color: 'var(--color-text-quaternary)' }}
                >
                  不再自动提示
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
