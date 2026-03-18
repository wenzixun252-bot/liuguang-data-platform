import GlobalSearch from '../components/GlobalSearch'

export default function SearchPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-gray-800">全局搜索</h1>
      <p className="text-sm text-gray-500">
        跨文档、会议、聊天、数据表统一搜索，支持按标签和类型筛选
      </p>

      {/* 全局搜索 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <GlobalSearch />
      </div>
    </div>
  )
}
