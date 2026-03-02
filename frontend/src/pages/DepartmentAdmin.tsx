import { useEffect, useState, useCallback, useRef } from 'react'
import { RefreshCw, ChevronDown, Shield, ShieldCheck, User, Pencil, X, Check } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface DepartmentNode {
  id: number
  feishu_department_id: string
  name: string
  parent_id: number | null
  children: DepartmentNode[]
}

interface VisibleDeptItem {
  department_id: number
  department_name: string
}

interface UserPermission {
  user_id: number
  user_name: string
  feishu_open_id: string
  role: string
  departments: string[]
  is_manager: boolean
  auto_visible_depts: VisibleDeptItem[]
  override_visible_depts: VisibleDeptItem[]
}

type EffectiveRole = 'admin' | 'dept_manager' | 'employee'

function getEffectiveRole(u: UserPermission): EffectiveRole {
  if (u.role === 'admin') return 'admin'
  if (u.is_manager) return 'dept_manager'
  return 'employee'
}

const ROLE_CONFIG: Record<EffectiveRole, { label: string; color: string; bg: string; icon: typeof Shield; desc: string }> = {
  admin: { label: '系统管理员', color: 'text-red-700', bg: 'bg-red-100 hover:bg-red-200', icon: ShieldCheck, desc: '可查看所有数据资产' },
  dept_manager: { label: '部门管理员', color: 'text-blue-700', bg: 'bg-blue-100 hover:bg-blue-200', icon: Shield, desc: '可查看本部门员工数据' },
  employee: { label: '普通用户', color: 'text-gray-700', bg: 'bg-gray-100 hover:bg-gray-200', icon: User, desc: '仅查看自己的数据' },
}

/** 扁平化部门树 */
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

export default function DepartmentAdmin() {
  const [users, setUsers] = useState<UserPermission[]>([])
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

  const handleSetRole = async (u: UserPermission, targetRole: EffectiveRole) => {
    const currentRole = getEffectiveRole(u)
    if (currentRole === targetRole) return

    try {
      if (targetRole === 'admin') {
        await api.patch(`/departments/users/${u.user_id}/role`, null, { params: { role: 'admin' } })
        if (u.is_manager) {
          // 需要取消所有部门的 manager 身份 — 这里用第一个部门
          await api.patch(`/departments/users/${u.user_id}/manager`, null, {
            params: { department_id: u.auto_visible_depts[0]?.department_id, is_manager: false },
          })
        }
      } else if (targetRole === 'dept_manager') {
        if (u.role === 'admin') {
          await api.patch(`/departments/users/${u.user_id}/role`, null, { params: { role: 'employee' } })
        }
        // 需要用户有部门，取第一个部门设为 manager
        // 注意：如果用户属于多个部门，可能需要更复杂的逻辑
        await api.patch(`/departments/users/${u.user_id}/manager`, null, {
          params: { department_id: u.auto_visible_depts[0]?.department_id || 0, is_manager: true },
        })
      } else {
        if (u.role === 'admin') {
          await api.patch(`/departments/users/${u.user_id}/role`, null, { params: { role: 'employee' } })
        }
        if (u.is_manager) {
          await api.patch(`/departments/users/${u.user_id}/manager`, null, {
            params: { department_id: u.auto_visible_depts[0]?.department_id, is_manager: false },
          })
        }
      }
      toast.success(`已设置为${ROLE_CONFIG[targetRole].label}`)
      loadData()
    } catch {
      toast.error('操作失败')
    }
  }

  const handleSaveVisibility = async (userId: number, deptIds: number[]) => {
    try {
      await api.put(`/departments/users/${userId}/visibility`, { department_ids: deptIds })
      toast.success('可见范围已更新')
      loadData()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '更新失败')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">权限管理</h1>
        <div className="bg-white rounded-xl p-8 shadow-sm text-center text-gray-400">加载中...</div>
      </div>
    )
  }

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
          同步飞书部门
        </button>
      </div>

      {/* Role legend */}
      <div className="flex flex-wrap gap-4">
        {(Object.entries(ROLE_CONFIG) as [EffectiveRole, typeof ROLE_CONFIG[EffectiveRole]][]).map(([key, cfg]) => {
          const Icon = cfg.icon
          return (
            <div key={key} className="flex items-center gap-2 text-sm text-gray-600">
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
                <Icon size={12} />
                {cfg.label}
              </span>
              <span>{cfg.desc}</span>
            </div>
          )
        })}
      </div>

      {/* Full-width user table */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        {users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">姓名</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">部门</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-medium">用户权限</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">数据可见范围</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const effectiveRole = getEffectiveRole(u)
                  const cfg = ROLE_CONFIG[effectiveRole]
                  const Icon = cfg.icon
                  return (
                    <tr key={u.user_id} className="border-t border-gray-100">
                      <td className="py-3 px-4 text-gray-800 font-medium">{u.user_name}</td>
                      <td className="py-3 px-4 text-gray-500">{u.departments.join(', ')}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center">
                          <RoleDropdown
                            currentRole={effectiveRole}
                            config={cfg}
                            icon={Icon}
                            onSelect={(role) => handleSetRole(u, role)}
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <VisibilityCell
                          user={u}
                          allDepts={allDepts}
                          onSave={(deptIds) => handleSaveVisibility(u.user_id, deptIds)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-center py-8">暂无用户数据，请点击"同步飞书部门"</p>
        )}
      </div>
    </div>
  )
}

function VisibilityCell({
  user,
  allDepts,
  onSave,
}: {
  user: UserPermission
  allDepts: { id: number; name: string }[]
  onSave: (deptIds: number[]) => void
}) {
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // admin 显示"全部"
  if (user.role === 'admin') {
    return <span className="text-xs text-red-600 font-medium">全部</span>
  }

  const autoIds = new Set(user.auto_visible_depts.map(d => d.department_id))

  const startEdit = () => {
    setSelected(user.override_visible_depts.map(d => d.department_id))
    setEditing(true)
  }

  const handleSave = () => {
    onSave(selected)
    setEditing(false)
    setDropdownOpen(false)
  }

  const toggleDept = (id: number) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        {/* auto tags */}
        <div className="flex flex-wrap gap-1">
          {user.auto_visible_depts.map(d => (
            <span key={`auto-${d.department_id}`} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">
              {d.department_name}
              <span className="ml-1 text-gray-400">(自动)</span>
            </span>
          ))}
        </div>

        {/* multi-select dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full text-left border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white flex items-center justify-between"
          >
            <span className="text-gray-600">
              {selected.length > 0
                ? `已选 ${selected.length} 个部门`
                : '选择额外可见部门...'}
            </span>
            <ChevronDown size={12} />
          </button>
          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute left-0 mt-1 w-64 max-h-48 overflow-y-auto bg-white rounded-lg shadow-lg border border-gray-200 z-20 py-1">
                {allDepts.filter(d => !autoIds.has(d.id)).map(d => (
                  <label
                    key={d.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={() => toggleDept(d.id)}
                      className="rounded border-gray-300"
                    />
                    <span>{d.name}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-1">
          <button onClick={handleSave} className="p-1 text-green-600 hover:bg-green-50 rounded" title="保存">
            <Check size={14} />
          </button>
          <button onClick={() => { setEditing(false); setDropdownOpen(false) }} className="p-1 text-gray-400 hover:bg-gray-50 rounded" title="取消">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  // 非编辑态
  const hasAuto = user.auto_visible_depts.length > 0
  const hasOverride = user.override_visible_depts.length > 0

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {!hasAuto && !hasOverride && (
        <span className="text-xs text-gray-400">仅自己</span>
      )}
      {user.auto_visible_depts.map(d => (
        <span key={`auto-${d.department_id}`} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">
          {d.department_name}
          <span className="ml-1 text-gray-400">(自动)</span>
        </span>
      ))}
      {user.override_visible_depts.map(d => (
        <span key={`ov-${d.department_id}`} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700">
          {d.department_name}
        </span>
      ))}
      <button
        onClick={startEdit}
        className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
        title="编辑可见范围"
      >
        <Pencil size={12} />
      </button>
    </div>
  )
}

function RoleDropdown({
  currentRole,
  config,
  icon: Icon,
  onSelect,
}: {
  currentRole: EffectiveRole
  config: typeof ROLE_CONFIG[EffectiveRole]
  icon: typeof Shield
  onSelect: (role: EffectiveRole) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${config.bg} ${config.color}`}
      >
        <Icon size={12} />
        {config.label}
        <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 z-20 py-1">
            {(Object.entries(ROLE_CONFIG) as [EffectiveRole, typeof ROLE_CONFIG[EffectiveRole]][]).map(([key, rcfg]) => {
              const RIcon = rcfg.icon
              return (
                <button
                  key={key}
                  onClick={() => {
                    onSelect(key)
                    setOpen(false)
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50 ${
                    key === currentRole ? 'font-semibold bg-gray-50' : ''
                  }`}
                >
                  <RIcon size={12} className={rcfg.color} />
                  <span>{rcfg.label}</span>
                  {key === currentRole && <span className="ml-auto text-indigo-500">&#10003;</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
