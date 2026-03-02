import { useEffect, useState } from 'react'
import { Search, ChevronLeft, ChevronRight, X, Paperclip, ExternalLink, Download, Image, User, Trash2 } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { ColumnSettingsButton, useColumnSettings, type ColumnDef } from '../components/ColumnSettings'
import { getUser } from '../lib/auth'

const MSG_COLUMNS: ColumnDef[] = [
  { key: 'sender', label: '发送人' },
  { key: 'content', label: '内容' },
  { key: 'uploader_name', label: '上传人' },
  { key: 'message_type', label: '类型', defaultVisible: false },
  { key: 'sent_at', label: '发送时间' },
  { key: 'attachments', label: '附件', defaultVisible: false },
  { key: 'chat_id', label: '会话 ID', defaultVisible: false },
]

interface AttachmentMeta {
  file_token: string
  name: string
  size: number
  type: string
}

interface LinkMeta {
  field_name: string
  text: string
  link: string
}

interface ChatMessageItem {
  id: number
  owner_id: string
  source_app_token: string | null
  source_table_id: string | null
  chat_id: string | null
  sender: string | null
  message_type: string | null
  content_text: string
  sent_at: string | null
  reply_to: string | null
  mentions: { name?: string; open_id?: string }[]
  uploader_name: string | null
  extra_fields?: { _attachments?: AttachmentMeta[]; _links?: LinkMeta[]; [key: string]: unknown }
  bitable_url: string | null
  created_at: string
}

interface ChatMessageListResponse {
  items: ChatMessageItem[]
  total: number
  page: number
  page_size: number
}

export default function Messages() {
  const [data, setData] = useState<ChatMessageListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [chatIdFilter, setChatIdFilter] = useState('')
  const [selected, setSelected] = useState<ChatMessageItem | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const { isVisible, toggle, columns: colDefs } = useColumnSettings('messages', MSG_COLUMNS)

  const pageSize = 20

  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: pageSize }
    if (search) params.search = search
    if (chatIdFilter) params.chat_id = chatIdFilter

    api.get('/chat-messages/list', { params })
      .then((res) => setData(res.data))
      .catch(() => toast.error('加载聊天记录失败'))
      .finally(() => setLoading(false))
  }, [page, search, chatIdFilter, refreshKey])

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">聊天记录</h1>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索消息..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <input
            type="text"
            placeholder="会话 ID 筛选"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-40 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            value={chatIdFilter}
            onChange={(e) => { setChatIdFilter(e.target.value); setPage(1) }}
          />
          <ColumnSettingsButton columns={colDefs} isVisible={isVisible} toggle={toggle} />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {isVisible('sender') && <th className="text-left py-3 px-4 text-gray-500 font-medium">发送人</th>}
                    {isVisible('content') && <th className="text-left py-3 px-4 text-gray-500 font-medium">内容</th>}
                    {isVisible('uploader_name') && <th className="text-left py-3 px-4 text-gray-500 font-medium">上传人</th>}
                    {isVisible('message_type') && <th className="text-left py-3 px-4 text-gray-500 font-medium">类型</th>}
                    {isVisible('sent_at') && <th className="text-left py-3 px-4 text-gray-500 font-medium">发送时间</th>}
                    {isVisible('attachments') && <th className="text-left py-3 px-4 text-gray-500 font-medium">附件</th>}
                    {isVisible('chat_id') && <th className="text-left py-3 px-4 text-gray-500 font-medium">会话 ID</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => {
                    const attCount = item.extra_fields?._attachments?.length || 0
                    return (
                      <tr
                        key={item.id}
                        className="border-t border-gray-50 hover:bg-indigo-50/50 cursor-pointer transition-colors"
                        onClick={() => setSelected(item)}
                      >
                        {isVisible('sender') && <td className="py-3 px-4 text-gray-800 font-medium whitespace-nowrap">{item.sender || '-'}</td>}
                        {isVisible('content') && <td className="py-3 px-4 text-gray-500 max-w-xs truncate">{item.content_text?.slice(0, 80)}</td>}
                        {isVisible('uploader_name') && <td className="py-3 px-4 text-gray-500">{item.uploader_name || '-'}</td>}
                        {isVisible('message_type') && <td className="py-3 px-4 text-gray-500">{item.message_type || '-'}</td>}
                        {isVisible('sent_at') && <td className="py-3 px-4 text-gray-500 whitespace-nowrap">{item.sent_at ? new Date(item.sent_at).toLocaleString('zh-CN') : '-'}</td>}
                        {isVisible('attachments') && (
                          <td className="py-3 px-4 text-gray-500">
                            {attCount > 0 ? (
                              <span className="flex items-center gap-1 text-indigo-600">
                                <Paperclip size={14} /> {attCount}
                              </span>
                            ) : '-'}
                          </td>
                        )}
                        {isVisible('chat_id') && <td className="py-3 px-4 text-gray-400 font-mono text-xs truncate max-w-[150px]">{item.chat_id || '-'}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-sm text-gray-500">共 {data.total} 条，第 {page}/{totalPages} 页</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30">
                    <ChevronLeft size={16} />
                  </button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-12 text-center text-gray-400">暂无聊天记录</div>
        )}
      </div>

      {selected && <MessageDetail msg={selected} onClose={() => setSelected(null)} onDelete={async (id) => {
        if (!confirm('确定要删除这条数据吗？')) return
        try {
          await api.delete(`/chat-messages/${id}`)
          toast.success('已删除')
          setSelected(null)
          setRefreshKey((k) => k + 1)
        } catch { toast.error('删除失败') }
      }} />}
    </div>
  )
}

function MessageDetail({ msg, onClose, onDelete }: { msg: ChatMessageItem; onClose: () => void; onDelete: (id: number) => void }) {
  const currentUser = getUser()
  const canDelete = currentUser && (currentUser.role === 'admin' || currentUser.feishu_open_id === msg.owner_id)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">消息详情</h2>
          <div className="flex items-center gap-2">
            {canDelete && (
              <button onClick={() => onDelete(msg.id)} className="p-1 hover:bg-red-50 rounded text-red-500 hover:text-red-700" title="删除">
                <Trash2 size={18} />
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          {msg.sender && <Field label="发送人" value={msg.sender} />}
          {msg.uploader_name && <Field label="上传人" value={msg.uploader_name} icon={<User size={14} />} />}
          {msg.message_type && <Field label="消息类型" value={msg.message_type} />}
          {msg.chat_id && <Field label="会话 ID" value={msg.chat_id} />}
          {msg.sent_at && <Field label="发送时间" value={new Date(msg.sent_at).toLocaleString('zh-CN')} />}
          {msg.reply_to && <Field label="回复" value={msg.reply_to} />}

          {msg.bitable_url && (
            <div>
              <p className="text-sm text-gray-500 mb-1">数据来源</p>
              <a
                href={msg.bitable_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm hover:bg-purple-100 transition-colors"
              >
                <ExternalLink size={14} />
                查看源多维表格
              </a>
            </div>
          )}

          {msg.mentions.length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">提及</p>
              <div className="flex flex-wrap gap-2">
                {msg.mentions.map((m, i) => (
                  <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">
                    @{m.name || m.open_id || '未知'}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm text-gray-500 mb-1">内容</p>
            <div className="text-sm text-gray-800 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap max-h-96 overflow-y-auto">
              {msg.content_text}
            </div>
          </div>
          <AttachmentsAndLinks extraFields={msg.extra_fields} />
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-gray-500 flex items-center gap-1">{icon}{label}</p>
      <p className="text-sm text-gray-800 font-medium">{value}</p>
    </div>
  )
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']

function isImage(name: string, type: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTS.includes(ext) || type.startsWith('image/')
}

function AttachmentsAndLinks({ extraFields }: { extraFields?: ChatMessageItem['extra_fields'] }) {
  const [preview, setPreview] = useState<string | null>(null)
  const attachments = extraFields?._attachments || []
  const links = extraFields?._links || []

  if (attachments.length === 0 && links.length === 0) return null

  return (
    <>
      {attachments.length > 0 && (
        <div>
          <p className="text-sm text-gray-500 mb-2 flex items-center gap-1"><Paperclip size={14} /> 附件</p>
          <div className="grid grid-cols-2 gap-2">
            {attachments.map((att) =>
              isImage(att.name, att.type) ? (
                <div key={att.file_token} className="relative group cursor-pointer" onClick={() => setPreview(`/api/upload/attachments/${att.file_token}`)}>
                  <img
                    src={`/api/upload/attachments/${att.file_token}`}
                    alt={att.name}
                    className="w-full h-32 object-cover rounded-lg border border-gray-200"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
                    <Image size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-xs text-gray-500 mt-1 truncate">{att.name}</p>
                </div>
              ) : (
                <a
                  key={att.file_token}
                  href={`/api/upload/attachments/${att.file_token}`}
                  download
                  className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <Download size={16} className="text-gray-400 shrink-0" />
                  <span className="text-sm text-gray-700 truncate">{att.name || att.file_token}</span>
                </a>
              )
            )}
          </div>
        </div>
      )}

      {links.length > 0 && (
        <div>
          <p className="text-sm text-gray-500 mb-2 flex items-center gap-1"><ExternalLink size={14} /> 超链接</p>
          <div className="space-y-1">
            {links.map((lnk, i) => (
              <a
                key={i}
                href={lnk.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
              >
                <ExternalLink size={14} className="shrink-0" />
                {lnk.text || lnk.field_name || lnk.link}
              </a>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center" onClick={() => setPreview(null)}>
          <img src={preview} alt="预览" className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  )
}
