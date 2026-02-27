/** 飞书 OAuth 相关配置 */

const FEISHU_APP_ID = import.meta.env.VITE_FEISHU_APP_ID || ''
const REDIRECT_URI = import.meta.env.VITE_FEISHU_REDIRECT_URI || `${window.location.origin}/login`

export function getFeishuAuthUrl(): string {
  const params = new URLSearchParams({
    app_id: FEISHU_APP_ID,
    redirect_uri: REDIRECT_URI,
    state: 'feishu_login',
  })
  return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}`
}
