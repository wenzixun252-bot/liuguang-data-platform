import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  paramsSerializer: (params) => {
    // FastAPI 需要 tag_ids=1&tag_ids=2 格式，axios 默认会加 []
    const parts: string[] = []
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const v of value) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`)
      } else {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      }
    }
    return parts.join('&')
  },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (localStorage.getItem('admin_mode') === 'true') {
    config.headers['X-Admin-Mode'] = 'true'
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default api

// ── 提取规则 API ──
export const getExtractionRules = () => api.get('/extraction-rules').then(r => r.data)
export const createExtractionRule = (data: any) => api.post('/extraction-rules', data).then(r => r.data)
export const updateExtractionRule = (id: number, data: any) => api.put(`/extraction-rules/${id}`, data).then(r => r.data)
export const deleteExtractionRule = (id: number) => api.delete(`/extraction-rules/${id}`).then(r => r.data)
export const getExtractionTemplates = () => api.get('/extraction-rules/templates').then(r => r.data)

// ── 清洗规则 API ──
export const getCleaningRules = () => api.get('/cleaning-rules').then(r => r.data)
export const createCleaningRule = (data: any) => api.post('/cleaning-rules', data).then(r => r.data)
export const updateCleaningRule = (id: number, data: any) => api.put(`/cleaning-rules/${id}`, data).then(r => r.data)
export const deleteCleaningRule = (id: number) => api.delete(`/cleaning-rules/${id}`).then(r => r.data)
