import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import api from '../lib/api'

export interface TaskItem {
  id: string
  label: string
  status: 'running' | 'done' | 'error'
  progress: number // 0-100, -1 表示不确定进度（indeterminate）
  message: string
  createdAt: number
  navigateTo?: string // 任务完成后点击跳转的路径
}

interface TaskProgressContextValue {
  tasks: TaskItem[]
  addTask: (id: string, label: string, navigateTo?: string) => void
  updateTask: (id: string, updates: Partial<Pick<TaskItem, 'status' | 'progress' | 'message' | 'navigateTo'>>) => void
  removeTask: (id: string) => void
  cancelTask: (id: string) => Promise<void>
  clearDone: () => void
}

const TaskProgressContext = createContext<TaskProgressContextValue | null>(null)

export function TaskProgressProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<TaskItem[]>([])

  const addTask = useCallback((id: string, label: string, navigateTo?: string) => {
    setTasks(prev => {
      // 如果已存在同 id 且已完成/出错的任务，不要重置它
      const existing = prev.find(t => t.id === id)
      if (existing && (existing.status === 'done' || existing.status === 'error')) {
        return prev
      }
      const filtered = prev.filter(t => t.id !== id)
      return [
        { id, label, status: 'running', progress: -1, message: '准备中...', createdAt: Date.now(), navigateTo },
        ...filtered,
      ]
    })
  }, [])

  const updateTask = useCallback((id: string, updates: Partial<Pick<TaskItem, 'status' | 'progress' | 'message' | 'navigateTo'>>) => {
    setTasks(prev =>
      prev.map(t => (t.id === id ? { ...t, ...updates } : t))
    )
  }, [])

  const removeTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
  }, [])

  const cancelTask = useCallback(async (id: string) => {
    // 根据任务 ID 前缀调用对应的后端取消 API
    try {
      if (id === 'kg-build' || id.startsWith('kg-build')) {
        await api.post('/knowledge-graph/cancel-build')
      } else if (id.startsWith('sync-')) {
        // ETL 同步任务 — 目前没有单独取消接口，仅前端移除
      } else if (id.startsWith('import-task-')) {
        const taskId = id.replace('import-task-', '')
        await api.post(`/data-import/tasks/${taskId}/cancel`)
      } else if (id.startsWith('feishu-import-')) {
        const taskId = id.replace('feishu-import-', '')
        await api.post(`/import/tasks/${taskId}/cancel`)
      } else if (id.startsWith('chat-')) {
        // 通过自定义事件通知 Chat 组件 abort SSE 连接
        window.dispatchEvent(new CustomEvent('cancel-chat-task', { detail: { taskId: id } }))
      }
    } catch {
      // 后端取消失败也继续在前端标记取消
    }
    // 前端标记为已取消（用 error 状态 + 提示信息）
    setTasks(prev =>
      prev.map(t => t.id === id ? { ...t, status: 'error', message: '已取消' } : t)
    )
  }, [])

  const clearDone = useCallback(() => {
    setTasks(prev => prev.filter(t => t.status === 'running'))
  }, [])

  return (
    <TaskProgressContext.Provider value={{ tasks, addTask, updateTask, removeTask, cancelTask, clearDone }}>
      {children}
    </TaskProgressContext.Provider>
  )
}

export function useTaskProgress() {
  const ctx = useContext(TaskProgressContext)
  if (!ctx) throw new Error('useTaskProgress must be used within TaskProgressProvider')
  return ctx
}
