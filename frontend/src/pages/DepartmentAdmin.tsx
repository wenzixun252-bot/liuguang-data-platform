import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, ChevronDown, ChevronRight, ShieldCheck, User as UserIcon, X, Check, Search, Share2, Building2 } from 'lucide-react'
import api from '../lib/api'
import { getUser, isAdmin } from '../lib/auth'
import toast from 'react-hot-toast'

interface DeptBrief {
  department_id: number
  department_name: string
}

interface VisibleUserItem {
  user_id: number
  user_name: string
}

interface DepartmentNode {
  id: number
  name: string
  children: DepartmentNode[]
}

interface UserPermission {
  user_id: number
  user_name: string
  feishu_open_id: string
  role: string
  dept_list: DeptBrief[]
  is_manager: boolean
  shared_to_users: VisibleUserItem[]
  shared_to_depts: DeptBrief[]
}

/** 扁平化部门树（供 SharingEditor 下拉用） */
function flattenDepts(nodes: DepartmentNode[]): { id: number; name: string }[] {
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

/** 构建 deptId → 直属用户 映射 */
function buildDeptMemberMap(users: UserPermission[]): Map<number, UserPermission[]> {
  const map = new Map<number, UserPermission[]>()
  for (const u of users) {
    for (const d of u.dept_list) {
      if (!map.has(d.department_id)) map.set(d.department_id, [])
      map.get(d.department_id)!.push(u)
    }
  }
  return map
}

/** 统计树节点下（含子节点）的总人数 */
function countMembers(node: DepartmentNode, memberMap: Map<number, UserPermission[]>): number {
  let count = memberMap.get(node.id)?.length ?? 0
  for (const child of node.children) {
    count += countMembers(child, memberMap)
  }
  return count
}

export default function DepartmentAdmin() {
  const currentUser = getUser()
  const admin = isAdmin(currentUser)
  const [users, setUsers] = useState<UserPermission[]>([])
  const [deptTree, setDeptTree] = useState<DepartmentNode[]>([])
  const [allDepts, setAllDepts] = useState<{ id: number; name: string }[]>([])
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
        setAllDepts(flattenDepts(treeRes.data))
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

  const handleSaveSharing = async (
    userId: number,
    userIds: number[],
    deptIds: number[],
    isSelf: boolean,
  ) => {
    try {
      if (isSelf) {
        await api.put('/departments/my/sharing', { user_ids: userIds, department_ids: deptIds })
      } else {
        await api.put(`/departments/users/${userId}/visibility`, { user_ids: userIds, department_ids: deptIds })
      }
      toast.success('分享设置已更新')
      loadData()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '更新失败')
    }
  }

  const myData = users.find(u => u.feishu_open_id === currentUser?.feishu_open_id)

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">权限管理</h1>
        <div className="bg-white rounded-xl p-8 shadow-sm text-center text-gray-400">加载中...</div>
      </div>
    )
  }

  // ── 普通用户视图：只看自己 ──
  if (!admin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">权限管理</h1>
        {myData && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
                {myData.user_name[0]}
              </div>
              <div>
                <div className="font-semibold text-gray-800">{myData.user_name}</div>
                <div className="text-xs text-gray-500">
                  {myData.dept_list.map(d => d.department_name).join(', ') || '未分配部门'}
                </div>
              </div>
              <RoleBadge role={myData.role} />
            </div>
            <div className="border-t border-gray-100 pt-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
                <Share2 size={15} />
                我的数据分享
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                选择要分享给哪些同事或部门。被分享的人可以查看你的文档、会议和聊天记录。
              </p>
              <SharingEditor
                currentUsers={myData.shared_to_users}
                currentDepts={myData.shared_to_depts}
                allUsers={users}
                allDepts={allDepts}
                selfId={myData.user_id}
                onSave={(uids, dids) => handleSaveSharing(myData.user_id, uids, dids, true)}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── 超管视图：按部门树层级展示 ──
  const memberMap = buildDeptMemberMap(users)

  // 未分配部门的用户
  const noDeptUsers = users.filter(u => u.dept_list.length === 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">权限管理</h1>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          同步飞书通讯录
        </button>
      </div>

      {deptTree.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {deptTree.map(node => (
            <DeptTreeNode
              key={node.id}
              node={node}
              depth={0}
              memberMap={memberMap}
              currentUser={currentUser}
              allUsers={users}
              allDepts={allDepts}
              onSaveSharing={handleSaveSharing}
            />
          ))}
          {noDeptUsers.length > 0 && (
            <NoDeptSection
              users={noDeptUsers}
              currentUser={currentUser}
              allUsers={users}
              allDepts={allDepts}
              onSaveSharing={handleSaveSharing}
            />
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
          暂无用户数据，请点击"同步飞书通讯录"
        </div>
      )}
    </div>
  )
}

/** 递归渲染部门树节点 */
function DeptTreeNode({
  node,
  depth,
  memberMap,
  currentUser,
  allUsers,
  allDepts,
  onSaveSharing,
}: {
  node: DepartmentNode
  depth: number
  memberMap: Map<number, UserPermission[]>
  currentUser: any
  allUsers: UserPermission[]
  allDepts: { id: number; name: string }[]
  onSaveSharing: (userId: number, userIds: number[], deptIds: number[], isSelf: boolean) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const directMembers = memberMap.get(node.id) ?? []
  const totalCount = countMembers(node, memberMap)
  const hasContent = totalCount > 0 || node.children.length > 0

  if (!hasContent && directMembers.length === 0) return null

  // 不同层级的缩进和样式
  const depthStyles = [
    { bg: 'bg-gray-50', text: 'text-gray-900', size: 'text-sm', py: 'py-3.5', icon: 18 },    // 一级
    { bg: 'bg-gray-50/50', text: 'text-gray-800', size: 'text-sm', py: 'py-3', icon: 16 },    // 二级
    { bg: '', text: 'text-gray-700', size: 'text-xs', py: 'py-2.5', icon: 14 },               // 三级+
  ]
  const style = depthStyles[Math.min(depth, depthStyles.length - 1)]

  return (
    <div>
      {/* 部门行 */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2 ${style.py} hover:bg-gray-50 transition-colors border-b border-gray-100`}
        style={{ paddingLeft: `${20 + depth * 24}px` }}
      >
        {open
          ? <ChevronDown size={14} className="text-gray-400 shrink-0" />
          : <ChevronRight size={14} className="text-gray-400 shrink-0" />
        }
        <Building2 size={style.icon} className="text-indigo-500 shrink-0" />
        <span className={`font-semibold ${style.text} ${style.size}`}>{node.name}</span>
        <span className="text-xs text-gray-400 ml-1">
          {directMembers.length > 0 && `${directMembers.length} 人`}
          {directMembers.length > 0 && node.children.length > 0 && '，'}
          {node.children.length > 0 && `${node.children.length} 个子部门`}
        </span>
      </button>

      {open && (
        <>
          {/* 直属成员表格 */}
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
                        <div className="flex items-center justify-center">
                          <RoleBadge role={u.role} />
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <SharingDisplay
                          user={u}
                          allUsers={allUsers}
                          allDepts={allDepts}
                          canEdit
                          onSave={(uids, dids) => onSaveSharing(u.user_id, uids, dids, false)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 子部门（递归） */}
          {node.children.map(child => (
            <DeptTreeNode
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

/** 未分配部门用户 */
function NoDeptSection({
  users,
  currentUser,
  allUsers,
  allDepts,
  onSaveSharing,
}: {
  users: UserPermission[]
  currentUser: any
  allUsers: UserPermission[]
  allDepts: { id: number; name: string }[]
  onSaveSharing: (userId: number, userIds: number[], deptIds: number[], isSelf: boolean) => void
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
                <td className="py-2.5 px-4 w-28">
                  <div className="flex items-center justify-center">
                    <RoleBadge role={u.role} />
                  </div>
                </td>
                <td className="py-2.5 px-4">
                  <SharingDisplay
                    user={u}
                    allUsers={allUsers}
                    allDepts={allDepts}
                    canEdit
                    onSave={(uids, dids) => onSaveSharing(u.user_id, uids, dids, false)}
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

function RoleBadge({ role }: { role: string }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <ShieldCheck size={12} />
        超级管理员
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

/** 表格中的分享展示（admin 可编辑） */
function SharingDisplay({
  user,
  allUsers,
  allDepts,
  canEdit,
  onSave,
}: {
  user: UserPermission
  allUsers: UserPermission[]
  allDepts: { id: number; name: string }[]
  canEdit: boolean
  onSave: (userIds: number[], deptIds: number[]) => void
}) {
  const [editing, setEditing] = useState(false)

  if (user.role === 'admin') {
    return <span className="text-xs text-red-600 font-medium">全部（超管）</span>
  }

  if (editing && canEdit) {
    return (
      <SharingEditor
        currentUsers={user.shared_to_users}
        currentDepts={user.shared_to_depts}
        allUsers={allUsers}
        allDepts={allDepts}
        selfId={user.user_id}
        onSave={(uids, dids) => { onSave(uids, dids); setEditing(false) }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const hasUsers = user.shared_to_users.length > 0
  const hasDepts = user.shared_to_depts.length > 0

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {!hasUsers && !hasDepts && <span className="text-xs text-gray-400">未分享</span>}
      {user.shared_to_depts.map(d => (
        <span key={`d-${d.department_id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
          <Building2 size={10} />
          {d.department_name}
        </span>
      ))}
      {user.shared_to_users.map(u => (
        <span key={`u-${u.user_id}`} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700">
          {u.user_name}
        </span>
      ))}
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded text-xs"
        >
          编辑
        </button>
      )}
    </div>
  )
}

/** 分享编辑器：双 Tab — 选用户 / 选部门 */
function SharingEditor({
  currentUsers,
  currentDepts,
  allUsers,
  allDepts,
  selfId,
  onSave,
  onCancel,
}: {
  currentUsers: VisibleUserItem[]
  currentDepts: DeptBrief[]
  allUsers: UserPermission[]
  allDepts: { id: number; name: string }[]
  selfId: number
  onSave: (userIds: number[], deptIds: number[]) => void
  onCancel?: () => void
}) {
  const [selectedUsers, setSelectedUsers] = useState<number[]>(currentUsers.map(u => u.user_id))
  const [selectedDepts, setSelectedDepts] = useState<number[]>(currentDepts.map(d => d.department_id))
  const [tab, setTab] = useState<'user' | 'dept'>('user')
  const [search, setSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const toggleUser = (id: number) => {
    setSelectedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const toggleDept = (id: number) => {
    setSelectedDepts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const userCandidates = allUsers.filter(u => u.user_id !== selfId && u.role !== 'admin')
  const filteredUsers = search ? userCandidates.filter(u => u.user_name.includes(search)) : userCandidates
  const filteredDepts = search ? allDepts.filter(d => d.name.includes(search)) : allDepts

  return (
    <div className="flex flex-col gap-3">
      {/* 已选标签 */}
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {selectedDepts.length === 0 && selectedUsers.length === 0 && (
          <span className="text-xs text-gray-400 py-1">尚未分享给任何人</span>
        )}
        {selectedDepts.map(id => {
          const d = allDepts.find(d => d.id === id)
          return (
            <span key={`d-${id}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-green-100 text-green-700">
              <Building2 size={10} />
              {d?.name || id}
              <button onClick={() => toggleDept(id)} className="hover:text-red-500"><X size={10} /></button>
            </span>
          )
        })}
        {selectedUsers.map(id => {
          const u = allUsers.find(u => u.user_id === id)
          return (
            <span key={`u-${id}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-indigo-100 text-indigo-700">
              {u?.user_name || id}
              <button onClick={() => toggleUser(id)} className="hover:text-red-500"><X size={10} /></button>
            </span>
          )
        })}
      </div>

      {/* 选择下拉 */}
      <div className="relative">
        <button
          onClick={() => { setDropdownOpen(!dropdownOpen); setSearch('') }}
          className="text-left border border-gray-300 rounded-lg px-3 py-2 text-xs bg-white flex items-center gap-2 hover:border-indigo-400 transition-colors"
        >
          <Search size={12} className="text-gray-400" />
          <span className="text-gray-500">添加分享对象（用户或部门）...</span>
          <ChevronDown size={12} className="ml-auto text-gray-400" />
        </button>
        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
            <div className="absolute left-0 mt-1 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
              {/* Tab 切换 */}
              <div className="flex border-b border-gray-100">
                <button
                  onClick={() => { setTab('user'); setSearch('') }}
                  className={`flex-1 py-2 text-xs font-medium ${tab === 'user' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`}
                >
                  <UserIcon size={12} className="inline mr-1" />
                  选择用户
                </button>
                <button
                  onClick={() => { setTab('dept'); setSearch('') }}
                  className={`flex-1 py-2 text-xs font-medium ${tab === 'dept' ? 'text-green-600 border-b-2 border-green-600' : 'text-gray-500'}`}
                >
                  <Building2 size={12} className="inline mr-1" />
                  选择部门
                </button>
              </div>

              {/* 搜索 */}
              <div className="p-2 border-b border-gray-100">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 rounded">
                  <Search size={12} className="text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={tab === 'user' ? '搜索用户...' : '搜索部门...'}
                    className="bg-transparent text-xs outline-none flex-1"
                    autoFocus
                  />
                </div>
              </div>

              {/* 列表 */}
              <div className="max-h-52 overflow-y-auto py-1">
                {tab === 'user' ? (
                  filteredUsers.length > 0 ? filteredUsers.map(u => (
                    <label key={u.user_id} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(u.user_id)}
                        onChange={() => toggleUser(u.user_id)}
                        className="rounded border-gray-300 text-indigo-600"
                      />
                      <span className="font-medium">{u.user_name}</span>
                      <span className="text-gray-400 ml-auto truncate max-w-[140px]">
                        {u.dept_list.map(d => d.department_name).join(', ')}
                      </span>
                    </label>
                  )) : <div className="px-3 py-3 text-xs text-gray-400 text-center">无匹配用户</div>
                ) : (
                  filteredDepts.length > 0 ? filteredDepts.map(d => (
                    <label key={d.id} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedDepts.includes(d.id)}
                        onChange={() => toggleDept(d.id)}
                        className="rounded border-gray-300 text-green-600"
                      />
                      <Building2 size={12} className="text-green-600" />
                      <span className="font-medium">{d.name}</span>
                    </label>
                  )) : <div className="px-3 py-3 text-xs text-gray-400 text-center">无匹配部门</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          onClick={() => { onSave(selectedUsers, selectedDepts); setDropdownOpen(false) }}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700"
        >
          <Check size={12} />
          保存
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200"
          >
            取消
          </button>
        )}
      </div>
    </div>
  )
}
