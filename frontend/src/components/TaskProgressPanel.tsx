import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  X,
  ListTodo,
  ExternalLink,
  Clock,
} from 'lucide-react'
import { useTaskProgress, type TaskItem } from '../hooks/useTaskProgress'

/** 格式化时间戳为 MM-DD HH:mm:ss */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const MM = String(d.getMonth() + 1).padStart(2, '0')
  const DD = String(d.getDate()).padStart(2, '0')
  const HH = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${MM}-${DD} ${HH}:${mm}:${ss}`
}

function TaskRow({ task, onRemove, onCancel, onNavigate }: { task: TaskItem; onRemove: () => void; onCancel: () => void; onNavigate?: () => void }) {
  const isIndeterminate = task.progress === -1
  const isDone = task.status === 'done'
  const isError = task.status === 'error'
  const canNavigate = !!task.navigateTo
  const errorReason = isError ? (task.errorDetail || task.message) : ''

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="px-3 py-2.5 border-b border-black/[0.04] last:border-b-0"
    >
      <div className="flex items-center gap-2">
        {task.status === 'running' && (
          <Loader2 size={14} className="animate-spin text-indigo-500 shrink-0" />
        )}
        {isDone && <CheckCircle size={14} className="text-green-500 shrink-0" />}
        {isError && <AlertCircle size={14} className="text-red-500 shrink-0" />}

        <span
          className={`text-xs font-medium truncate flex-1 ${canNavigate ? 'cursor-pointer hover:text-indigo-600 transition-colors' : ''}`}
          style={{ color: 'var(--color-text-primary)' }}
          onClick={canNavigate ? onNavigate : undefined}
          title={canNavigate ? '点击查看' : undefined}
        >
          {task.label}
        </span>

        {canNavigate && (
          <button
            onClick={onNavigate}
            className="p-0.5 rounded hover:bg-indigo-50 transition-colors text-indigo-500"
            title="跳转查看"
          >
            <ExternalLink size={12} />
          </button>
        )}

        {task.status === 'running' && (
          <button
            onClick={onCancel}
            className="px-1.5 py-0.5 rounded-md text-[10px] font-medium text-red-500 hover:bg-red-50 transition-colors"
          >
            取消
          </button>
        )}

        {(isDone || isError) && (
          <button
            onClick={onRemove}
            className="p-0.5 rounded hover:bg-black/[0.06] transition-colors"
            style={{ color: 'var(--color-text-quaternary)' }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* 时间信息 */}
      <div className="mt-1 flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-quaternary)' }}>
        <Clock size={10} className="shrink-0" />
        <span>{formatTime(task.createdAt)}</span>
        {task.completedAt && (
          <>
            <span>→</span>
            <span>{formatTime(task.completedAt)}</span>
          </>
        )}
      </div>

      {/* 失败原因 */}
      {isError && errorReason && errorReason !== '已取消' && (
        <div className="mt-1 px-2 py-1 rounded-md bg-red-50 text-[10px] text-red-600 leading-relaxed break-all">
          {errorReason}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border-light, rgba(0,0,0,0.06))' }}>
          {isIndeterminate && task.status === 'running' ? (
            <div className="h-full w-1/3 bg-indigo-500 rounded-full animate-indeterminate" />
          ) : (
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isError ? 'bg-red-400' : isDone ? 'bg-green-500' : 'bg-indigo-500'
              }`}
              style={{ width: `${isDone ? 100 : Math.max(0, task.progress)}%` }}
            />
          )}
        </div>
        <span className="text-[10px] shrink-0 w-16 text-right" style={{ color: 'var(--color-text-tertiary)' }}>
          {task.message}
        </span>
      </div>
    </motion.div>
  )
}

/** 集成在 header 右上角的任务中心：触发按钮 + 下拉面板，自动隐藏 */
export default function TaskProgressPanel() {
  const { tasks, removeTask, cancelTask, clearDone } = useTaskProgress()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevRunningCountRef = useRef(0)

  const runningCount = tasks.filter(t => t.status === 'running').length
  const doneCount = tasks.filter(t => t.status !== 'running').length

  // 点击外部关闭面板
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 有新任务开始时自动弹出面板，3秒后自动收起
  const scheduleAutoHide = useCallback(() => {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current)
    autoHideTimer.current = setTimeout(() => setOpen(false), 3000)
  }, [])

  useEffect(() => {
    // 新增运行中任务时自动展开
    if (runningCount > prevRunningCountRef.current) {
      setOpen(true)
      scheduleAutoHide()
    }
    prevRunningCountRef.current = runningCount
  }, [runningCount, scheduleAutoHide])

  // 用户手动打开时清除自动隐藏
  const handleToggle = () => {
    setOpen(prev => {
      if (!prev) {
        // 打开时不自动隐藏，让用户自己关闭
        if (autoHideTimer.current) clearTimeout(autoHideTimer.current)
      }
      return !prev
    })
  }

  // 没有任务时不渲染
  if (tasks.length === 0) return null

  return (
    <div className="relative shrink-0 z-50" ref={containerRef}>
      {/* 触发按钮 —— 嵌入 header 栏 */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors shrink-0"
        style={{
          background: runningCount > 0 ? 'var(--color-accent-subtle, rgba(99,102,241,0.08))' : 'rgba(0,0,0,0.04)',
          color: runningCount > 0 ? 'var(--color-accent, #4f46e5)' : 'var(--color-text-secondary)',
        }}
        title="任务中心"
      >
        {runningCount > 0 ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <ListTodo size={13} />
        )}
        {runningCount > 0 ? `${runningCount} 个任务运行中` : `${doneCount} 个已完成`}
      </button>

      {/* 下拉面板 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="absolute right-0 top-full mt-2 w-72 z-[60]"
            style={{
              background: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderRadius: '14px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04)',
            }}
          >
            {/* 面板头部 */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <ListTodo size={15} className="text-indigo-500" />
              <span className="text-xs font-semibold flex-1" style={{ color: 'var(--color-text-primary)' }}>
                任务中心
              </span>
              {runningCount > 0 && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded-md text-[10px] font-medium">
                  <Loader2 size={10} className="animate-spin" />
                  {runningCount}
                </span>
              )}
              {doneCount > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); clearDone() }}
                  className="text-[10px] px-1.5 py-0.5 rounded-md hover:bg-black/[0.06] transition-colors"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  清除
                </button>
              )}
            </div>

            {/* 任务列表 */}
            <div className="border-t border-black/[0.04] max-h-64 overflow-y-auto">
              <AnimatePresence>
                {tasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onRemove={() => removeTask(task.id)}
                    onCancel={() => cancelTask(task.id)}
                    onNavigate={task.navigateTo ? () => {
                      navigate(task.navigateTo!)
                      setOpen(false)
                    } : undefined}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
