/** 飞书 OAuth 相关配置 */

const FEISHU_APP_ID = import.meta.env.VITE_FEISHU_APP_ID || ''
const REDIRECT_URI = import.meta.env.VITE_FEISHU_REDIRECT_URI || `${window.location.origin}/login`

export function getFeishuAuthUrl(): string {
  const params = new URLSearchParams({
    app_id: FEISHU_APP_ID,
    redirect_uri: REDIRECT_URI,
    state: 'feishu_login',
  })
  // 请求云文档和多维表格的用户身份访问权限
  // 注意：这些 scope 需要先在飞书开放平台后台开通
  const scopes = [
    'drive:drive:readonly',
    'bitable:app:readonly',
    'sheets:spreadsheet',  // 飞书表格读写
    'wiki:wiki:readonly',  // 知识空间（Wiki）只读，解析 Wiki 内嵌表格
    'docx:document',       // 云文档读写（含创建）
    'task:task',           // 任务读写（含创建）
    'offline_access',      // 获取 refresh_token
  ]
  return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}&scope=${scopes.join(' ')}`
}
