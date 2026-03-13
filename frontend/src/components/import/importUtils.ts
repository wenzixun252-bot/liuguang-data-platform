/**
 * 文件类型识别逻辑
 * 用于本地导入时自动识别文件类型并推荐分类
 */

export type ImportCategory = 'communication' | 'document' | 'structured' | 'unknown'

export interface FileClassification {
  category: ImportCategory
  categoryName: string
  extensions: string[]
  icon: string
  description: string
}

// 扩展名到分类的映射
const EXTENSION_MAP: Record<string, ImportCategory> = {
  // 沟通记录：音频、聊天导出
  mp3: 'communication',
  wav: 'communication',
  m4a: 'communication',
  aac: 'communication',
  ogg: 'communication',
  flac: 'communication',

  // 专业文档：文本类
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  md: 'document',
  markdown: 'document',
  txt: 'document',
  ppt: 'document',
  pptx: 'document',

  // 图片：归入文档资产（后端用视觉模型识别内容）
  png: 'document',
  jpg: 'document',
  jpeg: 'document',

  // 结构化表格：数据类
  xls: 'structured',
  xlsx: 'structured',
  csv: 'structured',
  tsv: 'structured',
  json: 'structured',
  xml: 'structured',
  sql: 'structured',
}

// 分类配置
export const CATEGORY_CONFIG: Record<ImportCategory, FileClassification> = {
  communication: {
    category: 'communication',
    categoryName: '沟通资产',
    extensions: ['MP3', 'WAV', 'M4A', '飞书/钉钉导出'],
    icon: 'AudioWaveform',
    description: '将语音或聊天转化为知识',
  },
  document: {
    category: 'document',
    categoryName: '文档资产',
    extensions: ['PDF', 'Word', 'PPT', 'Image'],
    icon: 'FileText',
    description: '归档您的重要文档资料',
  },
  structured: {
    category: 'structured',
    categoryName: '表格资产',
    extensions: ['Excel', 'CSV', 'SQL导出'],
    icon: 'Table2',
    description: '精准提取行列数据',
  },
  unknown: {
    category: 'unknown',
    categoryName: '其他文件',
    extensions: [],
    icon: 'File',
    description: '未知文件类型',
  },
}

/**
 * 识别单个文件的类型
 */
export function classifyFile(file: File): FileClassification {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const category = EXTENSION_MAP[ext] || 'unknown'
  return CATEGORY_CONFIG[category]
}

/**
 * 识别多个文件，返回主要分类
 */
export function classifyFiles(files: File[]): {
  primaryCategory: ImportCategory
  categoryCounts: Record<ImportCategory, number>
  classification: FileClassification
} {
  const counts: Record<ImportCategory, number> = {
    communication: 0,
    document: 0,
    structured: 0,
    unknown: 0,
  }

  for (const file of files) {
    const result = classifyFile(file)
    counts[result.category]++
  }

  // 找出数量最多的分类
  let maxCategory: ImportCategory = 'unknown'
  let maxCount = 0
  for (const [cat, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count
      maxCategory = cat as ImportCategory
    }
  }

  return {
    primaryCategory: maxCategory,
    categoryCounts: counts,
    classification: CATEGORY_CONFIG[maxCategory],
  }
}

/**
 * 获取文件类型的友好名称
 */
export function getFileTypeLabel(ext: string): string {
  const extLower = ext.toLowerCase()
  const typeLabels: Record<string, string> = {
    // 音频
    mp3: '音频文件',
    wav: '音频文件',
    m4a: '音频文件',
    aac: '音频文件',
    ogg: '音频文件',
    flac: '音频文件',
    // 文档
    pdf: 'PDF 文档',
    doc: 'Word 文档',
    docx: 'Word 文档',
    md: 'Markdown 文档',
    markdown: 'Markdown 文档',
    txt: '文本文件',
    ppt: 'PPT 演示文稿',
    pptx: 'PPT 演示文稿',
    // 图片
    png: '图片文件',
    jpg: '图片文件',
    jpeg: '图片文件',
    // 表格
    xls: 'Excel 表格',
    xlsx: 'Excel 表格',
    csv: 'CSV 表格',
    tsv: 'TSV 表格',
    json: 'JSON 数据',
    xml: 'XML 数据',
    sql: 'SQL 脚本',
  }
  return typeLabels[extLower] || '文件'
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}