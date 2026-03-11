import { useState } from 'react'
import { X, ChevronRight, ChevronLeft, Sparkles, User, Target, Database } from 'lucide-react'

interface KGProfileData {
  user_name: string
  user_role: string
  user_department: string
  user_description: string
  focus_people: string[]
  focus_projects: string[]
  domain_mode: 'function' | 'project' | 'collaboration' | 'content_type' | 'custom'
  custom_domains: string[]
  data_sources: string[]
  time_range_days: number
}

const DOMAIN_MODES = [
  { key: 'function', label: '按工作职能', desc: '数据治理、投资分析、财务管理...', emoji: '💼' },
  { key: 'project', label: '按项目事项', desc: '按参与的项目或事项主题划分', emoji: '📋' },
  { key: 'collaboration', label: '按协作对象', desc: '按协作的团队或人群划分', emoji: '🤝' },
  { key: 'content_type', label: '按内容类型', desc: '会议决策、文档沉淀、日常沟通...', emoji: '📂' },
] as const

interface Props {
  defaultValues?: Partial<KGProfileData>
  onSubmit: (data: KGProfileData) => void
  onClose: () => void
}

const STEPS = [
  { title: '我是谁', desc: '填写个人基本信息，让图谱更懂你', icon: User },
  { title: '我关注什么', desc: '标记重点人物和项目', icon: Target },
  { title: '数据范围', desc: '选择数据来源和时间范围', icon: Database },
]

const TIME_OPTIONS = [
  { value: 30, label: '最近 30 天' },
  { value: 90, label: '最近 90 天' },
  { value: 180, label: '最近 180 天' },
  { value: 0, label: '全部数据' },
]

export default function KGProfileWizard({ defaultValues, onSubmit, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<KGProfileData>({
    user_name: defaultValues?.user_name ?? '',
    user_role: defaultValues?.user_role ?? '',
    user_department: defaultValues?.user_department ?? '',
    user_description: defaultValues?.user_description ?? '',
    focus_people: defaultValues?.focus_people ?? [],
    focus_projects: defaultValues?.focus_projects ?? [],
    domain_mode: (defaultValues?.domain_mode as KGProfileData['domain_mode']) ?? 'function',
    custom_domains: defaultValues?.custom_domains ?? [],
    data_sources: defaultValues?.data_sources ?? ['document', 'meeting', 'chat'],
    time_range_days: defaultValues?.time_range_days ?? 90,
  })

  // 标签输入的临时值
  const [peopleInput, setPeopleInput] = useState('')
  const [projectInput, setProjectInput] = useState('')
  const [domainInput, setDomainInput] = useState('')

  type TagField = 'focus_people' | 'focus_projects' | 'custom_domains'

  const addTag = (field: TagField, value: string) => {
    const trimmed = value.trim()
    if (!trimmed || form[field].includes(trimmed)) return
    setForm(prev => ({ ...prev, [field]: [...prev[field], trimmed] }))
  }

  const removeTag = (field: TagField, index: number) => {
    setForm(prev => ({ ...prev, [field]: prev[field].filter((_, i) => i !== index) }))
  }

  const toggleDataSource = (source: string) => {
    setForm(prev => ({
      ...prev,
      data_sources: prev.data_sources.includes(source)
        ? prev.data_sources.filter(s => s !== source)
        : [...prev.data_sources, source],
    }))
  }

  const handleKeyDown = (e: React.KeyboardEvent, field: TagField, inputValue: string, setInput: (v: string) => void) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(field, inputValue)
      setInput('')
    }
  }

  const canProceed = step < 2
  const isLastStep = step === 2

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-lg mx-4 overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-indigo-600" />
            <h2 className="text-base font-semibold text-gray-800">配置你的数据图谱</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* 步骤指示器 */}
        <div className="px-6 pt-4">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              return (
                <div key={i} className="flex items-center gap-2 flex-1">
                  <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-all ${
                    i === step ? 'bg-indigo-600 text-white' :
                    i < step ? 'bg-indigo-100 text-indigo-600' :
                    'bg-gray-100 text-gray-400'
                  }`}>
                    <Icon size={14} />
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${
                    i === step ? 'text-indigo-700' : 'text-gray-400'
                  }`}>{s.title}</span>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-px ${i < step ? 'bg-indigo-300' : 'bg-gray-200'}`} />
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-gray-500 mt-2">{STEPS[step].desc}</p>
        </div>

        {/* 内容区域 */}
        <div className="px-6 py-5 min-h-[260px]">
          {step === 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">姓名</label>
                  <input
                    type="text"
                    value={form.user_name}
                    onChange={e => setForm(prev => ({ ...prev, user_name: e.target.value }))}
                    placeholder="你的名字"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">职位</label>
                  <input
                    type="text"
                    value={form.user_role}
                    onChange={e => setForm(prev => ({ ...prev, user_role: e.target.value }))}
                    placeholder="如：产品经理"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">部门</label>
                <input
                  type="text"
                  value={form.user_department}
                  onChange={e => setForm(prev => ({ ...prev, user_department: e.target.value }))}
                  placeholder="如：产品部"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">工作职责</label>
                <textarea
                  value={form.user_description}
                  onChange={e => setForm(prev => ({ ...prev, user_description: e.target.value }))}
                  placeholder="简要描述你的工作内容，如：负责流光项目的产品设计和迭代"
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all resize-none"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">重点关注的人物</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.focus_people.map((name, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 rounded-full px-3 py-1 text-xs font-medium">
                      {name}
                      <button onClick={() => removeTag('focus_people', i)} className="hover:text-indigo-900 transition-colors">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={peopleInput}
                  onChange={e => setPeopleInput(e.target.value)}
                  onKeyDown={e => handleKeyDown(e, 'focus_people', peopleInput, setPeopleInput)}
                  onBlur={() => { if (peopleInput.trim()) { addTag('focus_people', peopleInput); setPeopleInput('') } }}
                  placeholder="输入人名，按回车添加"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">重点关注的项目</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.focus_projects.map((name, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 rounded-full px-3 py-1 text-xs font-medium">
                      {name}
                      <button onClick={() => removeTag('focus_projects', i)} className="hover:text-amber-900 transition-colors">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={projectInput}
                  onChange={e => setProjectInput(e.target.value)}
                  onKeyDown={e => handleKeyDown(e, 'focus_projects', projectInput, setProjectInput)}
                  onBlur={() => { if (projectInput.trim()) { addTag('focus_projects', projectInput); setProjectInput('') } }}
                  placeholder="输入项目名，按回车添加"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all"
                />
              </div>

              {/* 分类维度选择 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">图谱分类维度</label>
                <div className="grid grid-cols-2 gap-2">
                  {DOMAIN_MODES.map(m => (
                    <button
                      key={m.key}
                      onClick={() => setForm(prev => ({ ...prev, domain_mode: m.key as KGProfileData['domain_mode'] }))}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${
                        form.domain_mode === m.key
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-base">{m.emoji}</span>
                      <div>
                        <div className="text-xs font-medium">{m.label}</div>
                        <div className="text-[10px] text-gray-400 leading-tight">{m.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 自定义域名输入 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  自定义域名{form.domain_mode === 'custom' ? '' : '（可选，作为参考提示）'}
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.custom_domains.map((name, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 rounded-full px-3 py-1 text-xs font-medium">
                      {name}
                      <button onClick={() => removeTag('custom_domains', i)} className="hover:text-purple-900 transition-colors">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={domainInput}
                  onChange={e => setDomainInput(e.target.value)}
                  onKeyDown={e => handleKeyDown(e, 'custom_domains', domainInput, setDomainInput)}
                  onBlur={() => { if (domainInput.trim()) { addTag('custom_domains', domainInput); setDomainInput('') } }}
                  placeholder="如：数据治理、投资分析，按回车添加"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">数据来源</label>
                <div className="flex gap-3">
                  {[
                    { key: 'document', label: '文档', emoji: '📄' },
                    { key: 'meeting', label: '会议', emoji: '🎙️' },
                    { key: 'chat', label: '聊天记录', emoji: '💬' },
                  ].map(s => (
                    <button
                      key={s.key}
                      onClick={() => toggleDataSource(s.key)}
                      className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all ${
                        form.data_sources.includes(s.key)
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-lg">{s.emoji}</span>
                      <span className="text-xs font-medium">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">时间范围</label>
                <div className="grid grid-cols-2 gap-2">
                  {TIME_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setForm(prev => ({ ...prev, time_range_days: opt.value }))}
                      className={`py-2 rounded-lg border text-sm font-medium transition-all ${
                        form.time_range_days === opt.value
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={() => step > 0 ? setStep(step - 1) : onClose()}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ChevronLeft size={16} />
            {step > 0 ? '上一步' : '取消'}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{step + 1} / {STEPS.length}</span>
            {canProceed && (
              <button
                onClick={() => setStep(step + 1)}
                className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                下一步
                <ChevronRight size={16} />
              </button>
            )}
            {isLastStep && (
              <button
                onClick={() => onSubmit(form)}
                disabled={form.data_sources.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                <Sparkles size={14} />
                开始生成
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
