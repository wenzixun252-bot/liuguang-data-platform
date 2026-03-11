import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  User as UserIcon,
  Tag,
  RefreshCw,
  Bell,

  Search,
  X,

  Shield,
  Settings as SettingsIcon,

  ChevronDown,
  ChevronRight,
  Building2,
  ShieldCheck,
  Check,
} from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { TagManagerPanel } from '../components/TagManager'
import { getUser, isAdmin } from '../lib/auth'
import ETLAdmin from './ETLAdmin'

const BASE_TABS = [
  { key: 'data-permission', label: '数据权限', icon: Shield },
  { key: 'tags', label: '资产标签', icon: Tag },
  { key: 'notifications', label: '通知偏好', icon: Bell },
] as const

const ADMIN_TABS = [
  { key: 'admin', label: '管理员设置', icon: SettingsIcon },
] as const

type TabKey = (typeof BASE_TABS)[number]['key'] | (typeof ADMIN_TABS)[number]['key']

// ════════════════════════════════════════
// 数据权限 Tab
// ════════════════════════════════════════

interface DepartmentNode {
  id: number
  name: string
  children: DepartmentNode[]
}

interface UserBrief {
  id: number
  name: string
  department_ids: number[]
}

interface SharedToMeUser {
  user_id: number
  user_name: string
}

interface SharedToMeDepartment {
  department_id: number
  department_name: string
  users: SharedToMeUser[]
}

interface SharedToMeData {
  shared_by_users: SharedToMeUser[]
  shared_by_departments: SharedToMeDepartment[]
}

/** 从 permissions API 构建 dept→users 映射 */
function buildDeptUserMap(users: UserBrief[]): Map<number, UserBrief[]> {
  const map = new Map<number, UserBrief[]>()
  for (const u of users) {
    for (const did of u.department_ids) {
      if (!map.has(did)) map.set(did, [])
      map.get(did)!.push(u)
    }
  }
  return map
}

/** 搜索匹配：部门名或人员名包含关键词 */
function treeMatchesSearch(node: DepartmentNode, deptUserMap: Map<number, UserBrief[]>, keyword: string): boolean {
  if (node.name.toLowerCase().includes(keyword)) return true
  const members = deptUserMap.get(node.id) || []
  if (members.some(u => u.name.toLowerCase().includes(keyword))) return true
  return node.children.some(c => treeMatchesSearch(c, deptUserMap, keyword))
}

function DataPermissionTab() {
  const [sharing, setSharing] = useState<{ target_user_ids: number[]; target_department_ids: number[] }>({ target_user_ids: [], target_department_ids: [] })
  const [allUsers, setAllUsers] = useState<UserBrief[]>([])
  const [deptTree, setDeptTree] = useState<DepartmentNode[]>([])
  const [treeSearch, setTreeSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sharedToMe, setSharedToMe] = useState<SharedToMeData | null>(null)

  useEffect(() => {
    Promise.all([
      api.get('/settings/sharing'),
      api.get('/departments/users/permissions').catch(() => ({ data: [] })),
      api.get('/departments/tree').catch(() => ({ data: [] })),
      api.get('/settings/shared-to-me').catch(() => ({ data: null })),
    ]).then(([sharingRes, permRes, deptsRes, sharedToMeRes]) => {
      setSharing(sharingRes.data)
      setSharedToMe(sharedToMeRes.data)
      const permData: any[] = permRes.data
      const userMap = new Map<number, UserBrief>()
      for (const p of permData) {
        if (!userMap.has(p.user_id)) {
          userMap.set(p.user_id, { id: p.user_id, name: p.user_name, department_ids: [] })
        }
        const u = userMap.get(p.user_id)!
        for (const d of (p.dept_list || [])) {
          if (!u.department_ids.includes(d.department_id)) {
            u.department_ids.push(d.department_id)
          }
        }
      }
      setAllUsers(Array.from(userMap.values()))
      setDeptTree(Array.isArray(deptsRes.data) ? deptsRes.data : [])
    }).catch(() => toast.error('加载数据权限设置失败'))
      .finally(() => setLoading(false))
  }, [])

  const save = async (updated: typeof sharing) => {
    setSaving(true)
    try {
      const { data } = await api.put('/settings/sharing', updated)
      setSharing(data)
      toast.success('权限设置已保存')
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleUser = (uid: number) => {
    const has = sharing.target_user_ids.includes(uid)
    const updated = {
      ...sharing,
      target_user_ids: has
        ? sharing.target_user_ids.filter(id => id !== uid)
        : [...sharing.target_user_ids, uid],
    }
    setSharing(updated)
    save(updated)
  }

  const toggleDept = (deptId: number) => {
    const has = sharing.target_department_ids.includes(deptId)
    const updated = {
      ...sharing,
      target_department_ids: has
        ? sharing.target_department_ids.filter(id => id !== deptId)
        : [...sharing.target_department_ids, deptId],
    }
    setSharing(updated)
    save(updated)
  }

  if (loading) return <Loading />

  const deptUserMap = buildDeptUserMap(allUsers)
  const keyword = treeSearch.toLowerCase().trim()

  const hasSharedToMe = sharedToMe && (sharedToMe.shared_by_users.length > 0 || sharedToMe.shared_by_departments.length > 0)

  return (
    <div className="max-w-6xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ══ 左栏：我分享给了谁 ══ */}
        <div className="space-y-4">
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Shield size={16} className="text-indigo-600" />
              <h3 className="text-sm font-semibold text-indigo-900">我分享给了谁</h3>
              {saving && <span className="text-xs text-indigo-500 ml-auto">保存中...</span>}
            </div>
            <p className="text-xs text-indigo-700/70">
              选择哪些同事或部门可以查看你的文档、会议和聊天记录。未被选中的人无法看到你的数据。
            </p>
          </div>

          {/* 已选择的分享对象 */}
          {(sharing.target_user_ids.length > 0 || sharing.target_department_ids.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {sharing.target_department_ids.map(did => {
                const name = findDeptName(deptTree, did)
                return (
                  <span key={`d-${did}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs border border-green-200">
                    <Building2 size={12} />
                    {name || `部门#${did}`}
                    <button onClick={() => toggleDept(did)} className="hover:text-red-500 ml-0.5"><X size={12} /></button>
                  </span>
                )
              })}
              {sharing.target_user_ids.map(uid => {
                const u = allUsers.find(u => u.id === uid)
                return (
                  <span key={`u-${uid}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs border border-indigo-200">
                    <UserIcon size={12} />
                    {u?.name || `用户#${uid}`}
                    <button onClick={() => toggleUser(uid)} className="hover:text-red-500 ml-0.5"><X size={12} /></button>
                  </span>
                )
              })}
            </div>
          )}

          {/* 飞书风格：统一树状选择器（部门+人员） */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Building2 size={15} className="text-green-600" />
              选择部门或人员
            </h3>

            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={treeSearch}
                onChange={e => setTreeSearch(e.target.value)}
                placeholder="搜索部门或人员..."
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
              />
            </div>

            {deptTree.length > 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden max-h-[480px] overflow-y-auto">
                {deptTree.map(node => (
                  <FeishuDeptNode
                    key={node.id}
                    node={node}
                    depth={0}
                    deptUserMap={deptUserMap}
                    selectedDepts={sharing.target_department_ids}
                    selectedUsers={sharing.target_user_ids}
                    onToggleDept={toggleDept}
                    onToggleUser={toggleUser}
                    searchKeyword={keyword}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">暂无部门数据，请联系管理员同步飞书通讯录</p>
            )}
          </section>
        </div>

        {/* ══ 右栏：谁分享给了我 ══ */}
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={16} className="text-emerald-600" />
              <h3 className="text-sm font-semibold text-emerald-900">谁分享了数据给我</h3>
            </div>
            <p className="text-xs text-emerald-700/70">
              以下同事将他们的数据分享给了你，你可以在文档、会议等页面中看到他们的内容。
            </p>
          </div>

          {!sharedToMe ? (
            <div className="text-sm text-gray-400 py-8 text-center">加载中...</div>
          ) : !hasSharedToMe ? (
            <div className="bg-white rounded-xl border border-gray-200 py-12 text-center">
              <ShieldCheck size={32} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm text-gray-400">暂时没有人分享数据给你</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
              {/* 直接分享给我的人 */}
              {sharedToMe.shared_by_users.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 mb-2.5 flex items-center gap-1.5">
                    <UserIcon size={12} />
                    直接分享给我
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {sharedToMe.shared_by_users.map(u => (
                      <span key={u.user_id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs border border-indigo-200">
                        <span className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-[10px] font-bold shrink-0">
                          {u.user_name[0]}
                        </span>
                        {u.user_name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 通过部门分享给我的人 */}
              {sharedToMe.shared_by_departments.map(dept => (
                <div key={dept.department_id}>
                  <h4 className="text-xs font-medium text-gray-500 mb-2.5 flex items-center gap-1.5">
                    <Building2 size={12} className="text-green-600" />
                    通过「{dept.department_name}」部门分享
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {dept.users.map(u => (
                      <span key={u.user_id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs border border-green-200">
                        <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-[10px] font-bold shrink-0">
                          {u.user_name[0]}
                        </span>
                        {u.user_name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 在树中查找部门名称 */
function findDeptName(nodes: DepartmentNode[], id: number): string | null {
  for (const n of nodes) {
    if (n.id === id) return n.name
    const found = findDeptName(n.children, id)
    if (found) return found
  }
  return null
}

/** 飞书风格部门树节点：每层展示子部门和人员，可勾选 */
function FeishuDeptNode({
  node,
  depth,
  deptUserMap,
  selectedDepts,
  selectedUsers,
  onToggleDept,
  onToggleUser,
  searchKeyword,
}: {
  node: DepartmentNode
  depth: number
  deptUserMap: Map<number, UserBrief[]>
  selectedDepts: number[]
  selectedUsers: number[]
  onToggleDept: (id: number) => void
  onToggleUser: (id: number) => void
  searchKeyword: string
}) {
  const [open, setOpen] = useState(depth === 0)
  const members = deptUserMap.get(node.id) || []
  const hasChildren = node.children.length > 0
  const hasMembersOrChildren = members.length > 0 || hasChildren
  const isDeptSelected = selectedDepts.includes(node.id)

  // 搜索时自动展开匹配的节点
  const isSearching = searchKeyword.length > 0
  const matchesSelf = node.name.toLowerCase().includes(searchKeyword)
  const matchesAny = isSearching && treeMatchesSearch(node, deptUserMap, searchKeyword)

  // 搜索时隐藏不匹配的节点
  if (isSearching && !matchesAny) return null

  // 搜索时自动展开
  const effectiveOpen = isSearching ? matchesAny : open

  // 计算总人数（直属 + 子部门）
  const memberCount = members.length
  const childDeptCount = node.children.length

  // 过滤搜索中匹配的成员
  const visibleMembers = isSearching
    ? members.filter(u => u.name.toLowerCase().includes(searchKeyword) || matchesSelf)
    : members

  return (
    <div>
      {/* 部门行 */}
      <div
        className={`flex items-center gap-2 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 ${depth === 0 ? 'bg-gray-50/50' : ''}`}
        style={{ paddingLeft: `${16 + depth * 24}px`, paddingRight: '16px' }}
      >
        {/* 展开/折叠箭头 */}
        {hasMembersOrChildren ? (
          <button onClick={() => setOpen(!effectiveOpen)} className="p-0.5 text-gray-400 hover:text-gray-600 shrink-0">
            {effectiveOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-5" />
        )}

        {/* 部门勾选 */}
        <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
          <input
            type="checkbox"
            checked={isDeptSelected}
            onChange={() => onToggleDept(node.id)}
            className="rounded border-gray-300 text-green-600 focus:ring-green-500 shrink-0"
          />
          <Building2 size={14} className={isDeptSelected ? 'text-green-600' : 'text-gray-400'} />
          <span className={`text-sm truncate ${isDeptSelected ? 'text-green-700 font-medium' : 'text-gray-700'}`}>
            {node.name}
          </span>
          <span className="text-xs text-gray-400 ml-1 shrink-0">
            {memberCount > 0 && `${memberCount}人`}
            {memberCount > 0 && childDeptCount > 0 && ' · '}
            {childDeptCount > 0 && `${childDeptCount}个子部门`}
          </span>
        </label>
      </div>

      {/* 展开内容：先显示直属成员，再显示子部门 */}
      {effectiveOpen && (
        <div>
          {/* 直属成员 */}
          {visibleMembers.map(user => {
            const isUserSelected = selectedUsers.includes(user.id)
            return (
              <div
                key={`user-${user.id}`}
                className="flex items-center gap-2 py-2 hover:bg-blue-50/50 transition-colors border-b border-gray-50"
                style={{ paddingLeft: `${40 + depth * 24}px`, paddingRight: '16px' }}
              >
                <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={isUserSelected}
                    onChange={() => onToggleUser(user.id)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                  />
                  <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold shrink-0">
                    {user.name[0]}
                  </div>
                  <span className={`text-sm truncate ${isUserSelected ? 'text-indigo-700 font-medium' : 'text-gray-700'}`}>
                    {user.name}
                  </span>
                </label>
              </div>
            )
          })}

          {/* 子部门（递归） */}
          {node.children.map(child => (
            <FeishuDeptNode
              key={child.id}
              node={child}
              depth={depth + 1}
              deptUserMap={deptUserMap}
              selectedDepts={selectedDepts}
              selectedUsers={selectedUsers}
              onToggleDept={onToggleDept}
              onToggleUser={onToggleUser}
              searchKeyword={searchKeyword}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════
// Tab 3: 资产标签（复用 TagManagerPanel）
// ════════════════════════════════════════
function TagsTab() {
  return (
    <div className="max-w-2xl">
      <TagManagerPanel />
    </div>
  )
}

// (同步配置已移至数据导入模块)

// ════════════════════════════════════════
// Tab 5: 通知偏好
// ════════════════════════════════════════

const NOTIFICATION_ITEMS = [
  { key: 'on_sync_completed', label: '同步完成', desc: '数据源同步完成时通知' },
  { key: 'on_sync_failed', label: '同步失败', desc: '数据源同步出错时通知' },
  { key: 'on_new_data', label: '新数据到达', desc: '有新的数据资产入库时通知' },
  { key: 'on_tag_suggestion', label: '标签建议', desc: '系统推荐新标签时通知' },
  { key: 'on_share_received', label: '收到分享', desc: '有人将数据分享给你时通知' },
] as const

function NotificationsTab() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/settings/notifications')
      .then(r => setPrefs(r.data))
      .catch(() => toast.error('加载通知偏好失败'))
      .finally(() => setLoading(false))
  }, [])

  const handleToggle = async (key: string, value: boolean) => {
    const updated = { ...prefs, [key]: value }
    setPrefs(updated)
    try {
      await api.put('/settings/notifications', { [key]: value })
    } catch {
      // 回滚
      setPrefs(prefs)
      toast.error('保存失败')
    }
  }

  if (loading) return <Loading />

  return (
    <div className="max-w-lg space-y-1">
      {NOTIFICATION_ITEMS.map(item => (
        <div key={item.key} className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-gray-50">
          <div>
            <p className="text-sm font-medium text-gray-900">{item.label}</p>
            <p className="text-xs text-gray-500">{item.desc}</p>
          </div>
          <button
            onClick={() => handleToggle(item.key, !prefs[item.key])}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              prefs[item.key] ? 'bg-indigo-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                prefs[item.key] ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── 共用加载组件 ──
function Loading() {
  return <div className="text-sm text-gray-400 py-8 text-center">加载中...</div>
}

// ════════════════════════════════════════
// 管理员设置 Tab（合并权限管理 + ETL + 关键词同步管理）
// ════════════════════════════════════════

interface AdminUserPermission {
  user_id: number
  user_name: string
  feishu_open_id: string
  role: string
  dept_list: { department_id: number; department_name: string }[]
  is_manager: boolean
  shared_to_users: { user_id: number; user_name: string }[]
  shared_to_depts: { department_id: number; department_name: string }[]
}

function AdminSettingsTab() {
  const [subTab, setSubTab] = useState<'permissions' | 'sync' | 'keywords'>('permissions')

  return (
    <div className="space-y-4">
      {/* 子标签页 */}
      <div className="flex gap-2">
        {[
          { key: 'permissions' as const, label: '用户权限管理', icon: Shield },
          { key: 'sync' as const, label: '数据同步 (ETL)', icon: RefreshCw },
          { key: 'keywords' as const, label: '关键词同步管理', icon: Search },
        ].map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                subTab === t.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {subTab === 'permissions' && <AdminPermissionsSection />}
      {subTab === 'sync' && <ETLAdmin />}
      {subTab === 'keywords' && <AdminKeywordSection />}
    </div>
  )
}

/** 管理员权限管理：树状展示用户权限 */
function AdminPermissionsSection() {
  const currentUser = getUser()
  const [users, setUsers] = useState<AdminUserPermission[]>([])
  const [deptTree, setDeptTree] = useState<DepartmentNode[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const loadData = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get('/departments/users/permissions').catch(() => ({ data: [] })),
      api.get('/departments/tree').catch(() => ({ data: [] })),
    ])
      .then(([permRes, treeRes]) => {
        setUsers(permRes.data)
        setDeptTree(treeRes.data)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await api.post('/departments/sync')
      toast.success(`同步完成: ${res.data.departments_synced} 个部门, ${res.data.user_relations_synced} 条关系`)
      loadData()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const flatDepts = flattenDeptTree(deptTree)

  const handleSaveSharing = async (userId: number, userIds: number[], deptIds: number[]) => {
    try {
      await api.put(`/departments/users/${userId}/visibility`, { user_ids: userIds, department_ids: deptIds })
      toast.success('分享设置已更新')
      loadData()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '更新失败')
    }
  }

  if (loading) return <Loading />

  const memberMap = buildDeptMemberMap(users)
  const noDeptUsers = users.filter(u => u.dept_list.length === 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">管理所有用户的数据可见性配置，按部门组织展示。</p>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          同步飞书通讯录
        </button>
      </div>

      {deptTree.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {deptTree.map(node => (
            <AdminDeptTreeNode
              key={node.id}
              node={node}
              depth={0}
              memberMap={memberMap}
              currentUser={currentUser}
              allUsers={users}
              allDepts={flatDepts}
              onSaveSharing={handleSaveSharing}
            />
          ))}
          {noDeptUsers.length > 0 && (
            <AdminNoDeptSection
              users={noDeptUsers}
              currentUser={currentUser}
              allUsers={users}
              allDepts={flatDepts}
              onSaveSharing={handleSaveSharing}
            />
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400 border border-gray-200">
          暂无用户数据，请点击"同步飞书通讯录"
        </div>
      )}
    </div>
  )
}

function flattenDeptTree(nodes: DepartmentNode[]): { id: number; name: string }[] {
  const result: { id: number; name: string }[] = []
  function walk(list: DepartmentNode[]) {
    for (const n of list) {
      result.push({ id: n.id, name: n.name })
      if (n.children.length) walk(n.children)
    }
  }
  walk(nodes)
  return result
}

function buildDeptMemberMap(users: AdminUserPermission[]): Map<number, AdminUserPermission[]> {
  const map = new Map<number, AdminUserPermission[]>()
  for (const u of users) {
    for (const d of u.dept_list) {
      if (!map.has(d.department_id)) map.set(d.department_id, [])
      map.get(d.department_id)!.push(u)
    }
  }
  return map
}

function AdminDeptTreeNode({
  node, depth, memberMap, currentUser, allUsers, allDepts, onSaveSharing,
}: {
  node: DepartmentNode
  depth: number
  memberMap: Map<number, AdminUserPermission[]>
  currentUser: any
  allUsers: AdminUserPermission[]
  allDepts: { id: number; name: string }[]
  onSaveSharing: (userId: number, userIds: number[], deptIds: number[]) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const directMembers = memberMap.get(node.id) ?? []
  const hasContent = directMembers.length > 0 || node.children.length > 0
  if (!hasContent) return null

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 ${depth === 0 ? 'bg-gray-50/50' : ''}`}
        style={{ paddingLeft: `${20 + depth * 24}px` }}
      >
        {open ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
        <Building2 size={16} className="text-indigo-500 shrink-0" />
        <span className="font-semibold text-gray-800 text-sm">{node.name}</span>
        <span className="text-xs text-gray-400 ml-1">
          {directMembers.length > 0 && `${directMembers.length} 人`}
          {directMembers.length > 0 && node.children.length > 0 && '，'}
          {node.children.length > 0 && `${node.children.length} 个子部门`}
        </span>
      </button>
      {open && (
        <>
          {directMembers.length > 0 && (
            <div style={{ paddingLeft: `${depth * 24}px` }}>
              <table className="w-full text-sm">
                <tbody>
                  {directMembers.map(u => (
                    <tr key={u.user_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2.5 pl-14 pr-4 text-gray-800 font-medium w-40">
                        {u.user_name}
                        {u.feishu_open_id === currentUser?.feishu_open_id && (
                          <span className="ml-1.5 text-xs text-indigo-500">(我)</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 w-28">
                        <AdminRoleBadge role={u.role} />
                      </td>
                      <td className="py-2.5 px-4">
                        <AdminSharingDisplay
                          user={u}
                          allUsers={allUsers}
                          allDepts={allDepts}
                          onSave={(uids, dids) => onSaveSharing(u.user_id, uids, dids)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {node.children.map(child => (
            <AdminDeptTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              memberMap={memberMap}
              currentUser={currentUser}
              allUsers={allUsers}
              allDepts={allDepts}
              onSaveSharing={onSaveSharing}
            />
          ))}
        </>
      )}
    </div>
  )
}

function AdminNoDeptSection({
  users, currentUser, allUsers, allDepts, onSaveSharing,
}: {
  users: AdminUserPermission[]
  currentUser: any
  allUsers: AdminUserPermission[]
  allDepts: { id: number; name: string }[]
  onSaveSharing: (userId: number, userIds: number[], deptIds: number[]) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 py-3 px-5 hover:bg-gray-50 transition-colors border-b border-gray-100"
      >
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        <UserIcon size={16} className="text-gray-400" />
        <span className="font-semibold text-gray-500 text-sm">未分配部门</span>
        <span className="text-xs text-gray-400 ml-1">{users.length} 人</span>
      </button>
      {open && (
        <table className="w-full text-sm">
          <tbody>
            {users.map(u => (
              <tr key={u.user_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-2.5 pl-14 pr-4 text-gray-800 font-medium w-40">
                  {u.user_name}
                  {u.feishu_open_id === currentUser?.feishu_open_id && (
                    <span className="ml-1.5 text-xs text-indigo-500">(我)</span>
                  )}
                </td>
                <td className="py-2.5 px-4 w-28"><AdminRoleBadge role={u.role} /></td>
                <td className="py-2.5 px-4">
                  <AdminSharingDisplay
                    user={u}
                    allUsers={allUsers}
                    allDepts={allDepts}
                    onSave={(uids, dids) => onSaveSharing(u.user_id, uids, dids)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function AdminRoleBadge({ role }: { role: string }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <ShieldCheck size={12} />
        管理员
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
      <UserIcon size={12} />
      普通用户
    </span>
  )
}

function AdminSharingDisplay({
  user, allUsers, allDepts, onSave,
}: {
  user: AdminUserPermission
  allUsers: AdminUserPermission[]
  allDepts: { id: number; name: string }[]
  onSave: (userIds: number[], deptIds: number[]) => void
}) {
  const [editing, setEditing] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState<number[]>([])
  const [selectedDepts, setSelectedDepts] = useState<number[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'user' | 'dept'>('dept')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  if (user.role === 'admin') {
    return <span className="text-xs text-red-600 font-medium">全部可见（管理员）</span>
  }

  if (editing) {
    const userCandidates = allUsers.filter(u => u.user_id !== user.user_id && u.role !== 'admin')
    const filteredUsers = search ? userCandidates.filter(u => u.user_name.includes(search)) : userCandidates
    const filteredDepts = search ? allDepts.filter(d => d.name.includes(search)) : allDepts

    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {selectedDepts.length === 0 && selectedUsers.length === 0 && (
            <span className="text-xs text-gray-400 py-1">尚未分享</span>
          )}
          {selectedDepts.map(id => {
            const d = allDepts.find(d => d.id === id)
            return (
              <span key={`d-${id}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-green-100 text-green-700">
                <Building2 size={10} />{d?.name || id}
                <button onClick={() => setSelectedDepts(prev => prev.filter(x => x !== id))} className="hover:text-red-500"><X size={10} /></button>
              </span>
            )
          })}
          {selectedUsers.map(id => {
            const u = allUsers.find(u => u.user_id === id)
            return (
              <span key={`u-${id}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-indigo-100 text-indigo-700">
                {u?.user_name || id}
                <button onClick={() => setSelectedUsers(prev => prev.filter(x => x !== id))} className="hover:text-red-500"><X size={10} /></button>
              </span>
            )
          })}
        </div>
        <div className="relative">
          <button
            onClick={() => { setDropdownOpen(!dropdownOpen); setSearch('') }}
            className="text-left border border-gray-300 rounded-lg px-3 py-2 text-xs bg-white flex items-center gap-2 hover:border-indigo-400"
          >
            <Search size={12} className="text-gray-400" />
            <span className="text-gray-500">添加分享对象...</span>
            <ChevronDown size={12} className="ml-auto text-gray-400" />
          </button>
          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute left-0 mt-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                <div className="flex border-b border-gray-100">
                  <button onClick={() => { setTab('dept'); setSearch('') }} className={`flex-1 py-2 text-xs font-medium ${tab === 'dept' ? 'text-green-600 border-b-2 border-green-600' : 'text-gray-500'}`}>
                    部门
                  </button>
                  <button onClick={() => { setTab('user'); setSearch('') }} className={`flex-1 py-2 text-xs font-medium ${tab === 'user' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}>
                    用户
                  </button>
                </div>
                <div className="p-2 border-b border-gray-100">
                  <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={tab === 'user' ? '搜索用户...' : '搜索部门...'}
                    className="w-full bg-gray-50 text-xs px-2 py-1.5 rounded outline-none" autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto py-1">
                  {tab === 'dept' ? (
                    filteredDepts.length > 0 ? filteredDepts.map(d => (
                      <label key={d.id} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={selectedDepts.includes(d.id)} onChange={() => setSelectedDepts(prev => prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id])} className="rounded border-gray-300 text-green-600" />
                        <Building2 size={12} className="text-green-600" />{d.name}
                      </label>
                    )) : <div className="px-3 py-3 text-xs text-gray-400 text-center">无匹配</div>
                  ) : (
                    filteredUsers.length > 0 ? filteredUsers.map(u => (
                      <label key={u.user_id} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={selectedUsers.includes(u.user_id)} onChange={() => setSelectedUsers(prev => prev.includes(u.user_id) ? prev.filter(x => x !== u.user_id) : [...prev, u.user_id])} className="rounded border-gray-300 text-indigo-600" />
                        {u.user_name}
                      </label>
                    )) : <div className="px-3 py-3 text-xs text-gray-400 text-center">无匹配</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => { onSave(selectedUsers, selectedDepts); setEditing(false) }} className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700">
            <Check size={12} />保存
          </button>
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200">取消</button>
        </div>
      </div>
    )
  }

  const hasUsers = user.shared_to_users.length > 0
  const hasDepts = user.shared_to_depts.length > 0

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {!hasUsers && !hasDepts && <span className="text-xs text-gray-400">未分享</span>}
      {user.shared_to_depts.map(d => (
        <span key={`d-${d.department_id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
          <Building2 size={10} />{d.department_name}
        </span>
      ))}
      {user.shared_to_users.map(u => (
        <span key={`u-${u.user_id}`} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700">
          {u.user_name}
        </span>
      ))}
      <button
        onClick={() => {
          setSelectedUsers(user.shared_to_users.map(u => u.user_id))
          setSelectedDepts(user.shared_to_depts.map(d => d.department_id))
          setEditing(true)
        }}
        className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded text-xs"
      >
        编辑
      </button>
    </div>
  )
}

/** 管理员：关键词同步管理（全局） */
function AdminKeywordSection() {
  const [allRules, setAllRules] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/settings/keyword-rules?all=true')
      .then(r => setAllRules(r.data))
      .catch(() => {
        // fallback: 如果后端不支持 all 参数，退回普通列表
        api.get('/settings/keyword-rules').then(r => setAllRules(r.data)).catch(() => {})
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Loading />

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">查看和管理所有用户的关键词同步规则。</p>

      {allRules.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400 border border-gray-200">
          暂无关键词同步规则
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">关键词</th>
                <th className="text-left px-4 py-2 font-medium">用户</th>
                <th className="text-left px-4 py-2 font-medium">匹配数</th>
                <th className="text-left px-4 py-2 font-medium">含分享</th>
                <th className="text-left px-4 py-2 font-medium">状态</th>
                <th className="text-left px-4 py-2 font-medium">最后同步</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {allRules.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{r.keyword}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.owner_name || r.owner_id || '-'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.docs_matched ?? 0}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs ${r.include_shared ? 'text-green-600' : 'text-gray-400'}`}>
                      {r.include_shared ? '是' : '否'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {r.is_enabled ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {r.last_scan_time ? new Date(r.last_scan_time).toLocaleString('zh-CN') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════
// 主页面
// ════════════════════════════════════════
export default function Settings() {
  const user = getUser()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabs = isAdmin(user)
    ? [...BASE_TABS, ...ADMIN_TABS]
    : [...BASE_TABS]

  const defaultTab = 'data-permission'
  const urlTab = searchParams.get('tab') || defaultTab
  const activeTab: TabKey = tabs.some(t => t.key === urlTab) ? (urlTab as TabKey) : defaultTab

  const handleTabChange = (key: TabKey) => {
    if (key === defaultTab) {
      setSearchParams({})
    } else {
      setSearchParams({ tab: key })
    }
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'data-permission': return <DataPermissionTab />
      case 'tags': return <TagsTab />
      case 'notifications': return <NotificationsTab />
      case 'admin': return <AdminSettingsTab />
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">设置</h1>

      {/* Tab 栏 */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key as TabKey)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab 内容 */}
      <div className="pt-2">
        {renderTab()}
      </div>
    </div>
  )
}
