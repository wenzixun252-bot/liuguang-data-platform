import { useEffect, useState } from 'react'
import { Search, ChevronLeft, ChevronRight, X } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface AssetItem {
  feishu_record_id: string
  title: string | null
  asset_type: string
  content_text: string
  asset_tags: Record<string, unknown>
  synced_at: string
  feishu_created_at: string | null
  feishu_updated_at: string | null
}

interface AssetListResponse {
  items: AssetItem[]
  total: number
  page: number
  page_size: number
}

const TYPE_LABELS: Record<string, string> = {
  conversation: '会话',
  meeting_note: '会议纪要',
  document: '文档',
  other: '其他',
}

export default function Assets() {
  const [data, setData] = useState<AssetListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null)

  const pageSize = 20

  useEffect(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page, page_size: pageSize }
    if (search) params.search = search
    if (typeFilter) params.asset_type = typeFilter

    api
      .get('/assets/list', { params })
      .then((res) => setData(res.data))
      .catch(() => toast.error('加载资产列表失败'))
      .finally(() => setLoading(false))
  }, [page, search, typeFilter])

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">数据资产</h1>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索资产..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>

          <select
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="">全部类型</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">标题</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">类型</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium hidden md:table-cell">内容预览</th>
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">同步时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.feishu_record_id}
                      className="border-t border-gray-50 hover:bg-indigo-50/50 cursor-pointer transition-colors"
                      onClick={() => setSelectedAsset(item)}
                    >
                      <td className="py-3 px-4 text-gray-800 font-medium">
                        {item.title || '无标题'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-1 rounded-full text-xs bg-indigo-50 text-indigo-700">
                          {TYPE_LABELS[item.asset_type] || item.asset_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 max-w-xs truncate hidden md:table-cell">
                        {item.content_text?.slice(0, 80)}
                      </td>
                      <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                        {new Date(item.synced_at).toLocaleString('zh-CN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-sm text-gray-500">
                  共 {data.total} 条，第 {page}/{totalPages} 页
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-12 text-center text-gray-400">暂无数据资产</div>
        )}
      </div>

      {/* Detail panel */}
      {selectedAsset && (
        <AssetDetail asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
      )}
    </div>
  )
}

function AssetDetail({ asset, onClose }: { asset: AssetItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">资产详情</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <Field label="记录 ID" value={asset.feishu_record_id} />
          <Field label="标题" value={asset.title || '无标题'} />
          <Field label="类型" value={TYPE_LABELS[asset.asset_type] || asset.asset_type} />
          <Field label="同步时间" value={new Date(asset.synced_at).toLocaleString('zh-CN')} />
          {asset.feishu_created_at && (
            <Field label="飞书创建时间" value={new Date(asset.feishu_created_at).toLocaleString('zh-CN')} />
          )}
          <div>
            <p className="text-sm text-gray-500 mb-1">内容</p>
            <div className="text-sm text-gray-800 bg-gray-50 rounded-lg p-4 whitespace-pre-wrap max-h-96 overflow-y-auto">
              {asset.content_text}
            </div>
          </div>
          {asset.asset_tags && Object.keys(asset.asset_tags).length > 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-1">标签</p>
              <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-4 overflow-x-auto">
                {JSON.stringify(asset.asset_tags, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-sm text-gray-800 font-medium">{value}</p>
    </div>
  )
}
