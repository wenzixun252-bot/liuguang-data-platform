/**
 * 数据导入页面
 * 整合本地导入和飞书同步两种数据导入方式
 */

import LocalImportSection from '../components/import/LocalImportSection'
import FeishuSyncSection from '../components/import/FeishuSyncSection'

export default function DataImport() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">数据导入</h1>
        <p className="text-gray-500 mt-1">让数据找到它的归属之地</p>
      </div>

      {/* 主内容区：左右分栏 */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* 左侧：本地导入 (30%) */}
        <div className="w-full lg:w-[30%] min-w-[300px]">
          <LocalImportSection />
        </div>

        {/* 右侧：飞书同步 (70%) */}
        <div className="w-full lg:w-[70%] flex-1">
          <FeishuSyncSection />
        </div>
      </div>
    </div>
  )
}