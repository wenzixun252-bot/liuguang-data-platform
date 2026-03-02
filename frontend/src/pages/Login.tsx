import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getFeishuAuthUrl } from '../lib/feishu'
import { setAuth, getToken } from '../lib/auth'
import api from '../lib/api'
import toast from 'react-hot-toast'

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const codeHandled = useRef(false)

  // 已登录直接跳转
  useEffect(() => {
    if (getToken()) {
      navigate('/dashboard', { replace: true })
    }
  }, [navigate])

  // 处理飞书回调 code（防止 StrictMode 双重执行导致 code 被消费两次）
  useEffect(() => {
    const code = searchParams.get('code')
    if (!code || codeHandled.current) return
    codeHandled.current = true

    setLoading(true)
    api
      .post('/auth/feishu/callback', { code })
      .then((res) => {
        const { access_token, user } = res.data
        setAuth(access_token, user)
        toast.success(`欢迎回来，${user.name}`)
        navigate('/dashboard', { replace: true })
      })
      .catch((err) => {
        codeHandled.current = false
        toast.error(err.response?.data?.detail || '登录失败，请重试')
      })
      .finally(() => setLoading(false))
  }, [searchParams, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4">
            <span className="text-white text-2xl font-bold">LG</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">流光智能数据平台</h1>
          <p className="text-gray-500 mt-2">飞书企业级数据资产管理与智能问答</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8">
          <a
            href={getFeishuAuthUrl()}
            className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white font-medium transition-all ${
              loading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-md'
            }`}
            onClick={(e) => loading && e.preventDefault()}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                登录中...
              </>
            ) : (
              '使用飞书账号登录'
            )}
          </a>
        </div>
      </div>
    </div>
  )
}
