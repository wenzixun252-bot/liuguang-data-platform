import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import { getUser } from '../lib/auth'

interface StepState {
  done: boolean
  loading: boolean
}

interface QuickStartState {
  steps: [StepState, StepState, StepState]
  completedCount: number
  allDone: boolean
  isFirstVisit: boolean
  dismiss: () => void
  refetchAll: () => void
}

function getStorageKey() {
  const user = getUser()
  return `quickstart_${user?.feishu_open_id || 'default'}`
}

function getDismissed(): boolean {
  try {
    const raw = localStorage.getItem(getStorageKey())
    return raw ? JSON.parse(raw).dismissed === true : false
  } catch {
    return false
  }
}

function setDismissed() {
  localStorage.setItem(getStorageKey(), JSON.stringify({ dismissed: true }))
}

export function useQuickStart(): QuickStartState {
  const dismissed = getDismissed()

  // 步骤1：检测标签数量是否 >= 5
  const { data: tags, isLoading: loadingTags, refetch: refetchTags } = useQuery({
    queryKey: ['quickstart-tags'],
    queryFn: () => api.get('/tags').then(r => r.data),
    staleTime: 60_000,
  })

  // 步骤2：检测是否配置了会话/会议数据源或云文件夹
  const { data: commSources, isLoading: loadingCommSources, refetch: refetchCommSources } = useQuery({
    queryKey: ['quickstart-comm-sources'],
    queryFn: () => api.get('/import/sync-status', { params: { asset_type: 'communication' } }).then(r => r.data),
    staleTime: 60_000,
  })

  const { data: cloudFolders, isLoading: loadingCloudFolders, refetch: refetchCloudFolders } = useQuery({
    queryKey: ['quickstart-cloud-folders'],
    queryFn: () => api.get('/import/cloud-folders').then(r => r.data),
    staleTime: 60_000,
  })

  // 步骤3：检测对话记录
  const { data: conversations, isLoading: loadingConversations, refetch: refetchConversations } = useQuery({
    queryKey: ['quickstart-conversations'],
    queryFn: () => api.get('/conversations').then(r => r.data),
    staleTime: 60_000,
  })

  // 计算各步骤完成状态（实时检测，不缓存）
  const step1Done = Array.isArray(tags) && tags.length >= 5

  // 步骤2：三类数据源（会话、会议、云文件夹）全部配置才算完成
  const chatKeywords = ['会话', '群聊', '消息', '聊天', 'chat']
  const meetingKeywords = ['会议', '纪要', 'meeting']
  const commList = Array.isArray(commSources) ? commSources as { table_name: string }[] : []
  const hasChat = commList.some(s => chatKeywords.some(kw => s.table_name?.toLowerCase().includes(kw)))
  const hasMeeting = commList.some(s => meetingKeywords.some(kw => s.table_name?.toLowerCase().includes(kw)))
  const hasFolder = Array.isArray(cloudFolders) && cloudFolders.length > 0
  const step2Done = hasChat && hasMeeting && hasFolder
  const step3Done = Array.isArray(conversations) && conversations.length > 0

  const steps: [StepState, StepState, StepState] = [
    { done: !!step1Done, loading: loadingTags },
    { done: !!step2Done, loading: loadingCommSources || loadingCloudFolders },
    { done: !!step3Done, loading: loadingConversations },
  ]

  const completedCount = steps.filter(s => s.done).length
  const allDone = completedCount === 3

  const isFirstVisit = !dismissed && !allDone

  const dismiss = useCallback(() => {
    setDismissed()
  }, [])

  const refetchAll = useCallback(() => {
    refetchTags()
    refetchCommSources()
    refetchCloudFolders()
    refetchConversations()
  }, [refetchTags, refetchCommSources, refetchCloudFolders, refetchConversations])

  return useMemo(() => ({
    steps,
    completedCount,
    allDone,
    isFirstVisit,
    dismiss,
    refetchAll,
  }), [step1Done, step2Done, step3Done, dismissed, loadingTags, loadingCommSources, loadingCloudFolders, loadingConversations])
}
