import { useEffect, useRef, useCallback } from 'react'
import api from '../lib/api'
import { getToken } from '../lib/auth'

const SYNC_INTERVAL = 30 * 60 * 1000   // 30 分钟
const SYNC_MIN_GAP = 25 * 60 * 1000    // 最小间隔 25 分钟（防多标签页重复）
const LOCK_KEY = 'liuguang_last_auto_sync'

function getLastSyncTime(): number {
  try {
    return Number(localStorage.getItem(LOCK_KEY)) || 0
  } catch {
    return 0
  }
}

function setLastSyncTime() {
  try {
    localStorage.setItem(LOCK_KEY, String(Date.now()))
  } catch {
    // ignore
  }
}

/**
 * 30 分钟自动同步 Hook。
 * - 标签页可见且在线时，每 30 分钟调用 POST /api/import/auto-sync
 * - 标签页切回前台时，如果距上次同步 > 30 分钟则立即触发
 * - 用 localStorage 时间戳防止多标签页重复触发
 */
export function useAutoSync() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const triggerSync = useCallback(async () => {
    // 未登录则跳过
    if (!getToken()) return
    // 离线跳过
    if (!navigator.onLine) return
    // 标签页不可见跳过
    if (document.visibilityState === 'hidden') return
    // 多标签页去重：距上次同步不足 25 分钟则跳过
    if (Date.now() - getLastSyncTime() < SYNC_MIN_GAP) return

    setLastSyncTime()
    try {
      await api.post('/import/auto-sync')
    } catch {
      // 静默失败（401 会被 axios 拦截器处理）
    }
  }, [])

  useEffect(() => {
    // 启动定时器
    intervalRef.current = setInterval(triggerSync, SYNC_INTERVAL)

    // 标签页切回前台时检查是否需要立即同步
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - getLastSyncTime()
        if (elapsed >= SYNC_INTERVAL) {
          triggerSync()
        }
      }
    }

    // 网络恢复时检查是否需要同步
    const handleOnline = () => {
      const elapsed = Date.now() - getLastSyncTime()
      if (elapsed >= SYNC_INTERVAL) {
        triggerSync()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleOnline)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleOnline)
    }
  }, [triggerSync])
}
