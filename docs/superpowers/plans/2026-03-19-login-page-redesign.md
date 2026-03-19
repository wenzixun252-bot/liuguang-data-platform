# 登录页重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将登录页升级为左右分栏的苹果级高级质感界面，左侧白色品牌区 + 右侧深色 CSS 光影背景 + 毛玻璃登录卡片，保留现有飞书 OAuth 逻辑不变。

**Architecture:** 纯前端改动，两个文件：`index.css` 追加 login- 前缀的 CSS keyframes，`Login.tsx` 完整改写 JSX 结构和样式，逻辑层（OAuth 回调、loading 状态、导航）完整保留。

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, framer-motion（已安装）, 纯 CSS 动效

---

## 文件改动清单

| 操作 | 文件 | 说明 |
|------|------|------|
| Modify | `frontend/src/index.css` | 末尾追加 login- 前缀 keyframes |
| Modify | `frontend/src/pages/Login.tsx` | 完整改写 JSX，保留所有逻辑 |

---

## Task 1：添加 CSS Keyframes

**Files:**
- Modify: `frontend/src/index.css`（末尾追加）

- [ ] **Step 1：在 index.css 末尾追加 keyframes**

在 `frontend/src/index.css` 文件最末尾追加以下内容：

```css
/* ================================================================
   Login Page Animations (prefix: login-)
   ================================================================ */

@keyframes login-glowDrift1 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%       { transform: translate(30px, 20px) scale(1.1); }
}

@keyframes login-glowDrift2 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%       { transform: translate(-20px, -30px) scale(1.08); }
}

@keyframes login-glowDrift3 {
  0%, 100% { transform: translate(0, 0); }
  50%       { transform: translate(-15px, 20px); }
}

@keyframes login-sweepAcross {
  0%   { left: -2px; opacity: 0; }
  5%   { opacity: 1; }
  95%  { opacity: 1; }
  100% { left: calc(100% + 2px); opacity: 0; }
}

@keyframes login-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
```

- [ ] **Step 2：验证 CSS 语法**

```bash
cd frontend && npm run build 2>&1 | grep -i "error\|warning" | head -20
```

期望：无 CSS 解析错误

- [ ] **Step 3：Commit**

```bash
git add frontend/src/index.css
git commit -m "style: 添加登录页 CSS keyframes (login- 前缀)"
```

---

## Task 2：改写 Login.tsx

**Files:**
- Modify: `frontend/src/pages/Login.tsx`

### 完整替换内容如下：

- [ ] **Step 1：完整替换 Login.tsx**

用以下内容完整替换 `frontend/src/pages/Login.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { getFeishuAuthUrl } from '../lib/feishu'
import { setAuth, getToken } from '../lib/auth'
import api from '../lib/api'
import toast from 'react-hot-toast'

// ── Logo SVG（两道交叉弧线 + 中心圆点）──────────────────────────
function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path d="M4 13 Q10 3 16 7" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 7 Q10 17 16 13" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      <circle cx="10" cy="10" r="1.5" fill="white" />
    </svg>
  )
}

// ── 飞书图标 ────────────────────────────────────────────────────
function FeishuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M8 10.5l4-3 4 3M8 13.5l4 3 4-3" stroke="#1456f0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7.5v9" stroke="#1456f0" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const codeHandled = useRef(false)

  // 已登录直接跳转
  useEffect(() => {
    if (getToken()) {
      navigate('/data-insights', { replace: true })
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
        navigate('/data-insights', { replace: true })
      })
      .catch((err) => {
        codeHandled.current = false
        toast.error(err.response?.data?.detail || '登录失败，请重试')
      })
      .finally(() => setLoading(false))
  }, [searchParams, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#d8d8e4] p-6">
      {/* 整体卡片容器 */}
      <div className="w-full max-w-[1100px] min-h-[620px] flex rounded-3xl overflow-hidden"
        style={{ boxShadow: '0 40px 100px rgba(0,0,0,0.25), 0 8px 30px rgba(0,0,0,0.1)' }}>

        {/* ── 左侧品牌区 ── */}
        <motion.div
          className="hidden lg:flex flex-col justify-between bg-white relative overflow-hidden"
          style={{ flex: '0 0 55%', padding: '52px 56px' }}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* 极淡背景光晕 */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: `
              radial-gradient(ellipse 60% 50% at 90% 100%, rgba(99,102,241,0.06) 0%, transparent 100%),
              radial-gradient(ellipse 40% 40% at 10% 0%, rgba(139,92,246,0.04) 0%, transparent 100%)
            `
          }} />

          {/* Logo 区 */}
          <div className="relative z-10 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[10px] flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                boxShadow: '0 2px 12px rgba(99,102,241,0.3)'
              }}>
              <LogoMark size={20} />
            </div>
            <span className="text-[17px] font-semibold text-gray-900 tracking-tight">流光数据中台</span>
          </div>

          {/* 主文案 */}
          <div className="relative z-10">
            <p className="text-[12px] font-medium tracking-[0.08em] uppercase mb-3.5"
              style={{ color: '#6366f1' }}>
              Enterprise Data Platform
            </p>
            <h1 className="text-[38px] font-bold text-gray-900 leading-[1.18] tracking-[-0.03em] mb-4">
              连接飞书生态<br />
              让数据真正
              <em className="not-italic"
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text'
                }}>
                流动
              </em>
            </h1>
            <p className="text-[15px] text-gray-500 leading-[1.7] max-w-[340px] mb-10">
              集合文档、会议、多维表格，经由智能 ETL 清洗、
              向量化存储与知识图谱构建，驱动 AI 问答与业务洞察。
            </p>

            {/* 核心指标 */}
            <div className="flex gap-8">
              {[
                { num: '7', label: '步 ETL 流水线' },
                { num: '4', label: '行业提取模板' },
                { num: '1024', label: '维向量嵌入' },
              ].map(({ num, label }) => (
                <div key={label}>
                  <div className="text-[26px] font-bold tracking-[-0.03em] leading-none"
                    style={{
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text'
                    }}>
                    {num}
                  </div>
                  <div className="text-[12px] text-gray-400 mt-1">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 底部状态 */}
          <div className="relative z-10 flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-gray-200 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"
              style={{ boxShadow: '0 0 4px rgba(16,185,129,0.5)', animation: 'login-pulse 2s ease-in-out infinite' }} />
            <span className="text-[12px] text-gray-500">系统运行正常</span>
          </div>
        </motion.div>

        {/* ── 右侧深色光影区 ── */}
        {/* flex-1 在移动端占满（左侧 hidden），桌面端剩余 45% */}
        <motion.div
          className="relative flex-1 flex items-center justify-center overflow-hidden"
          style={{ padding: '40px 44px', background: '#0a0a14' }}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
        >
          {/* 静态渐变光源层 */}
          <div className="absolute inset-0" style={{
            background: `
              radial-gradient(ellipse 70% 55% at 15% 20%, rgba(99,102,241,0.38) 0%, rgba(79,82,200,0.18) 35%, transparent 70%),
              radial-gradient(ellipse 60% 50% at 90% 85%, rgba(139,92,246,0.30) 0%, rgba(109,60,210,0.12) 40%, transparent 70%),
              radial-gradient(ellipse 50% 40% at 50% 50%, rgba(99,102,241,0.08) 0%, transparent 70%),
              radial-gradient(ellipse 40% 35% at 95% 5%, rgba(56,189,248,0.12) 0%, transparent 60%)
            `,
            mixBlendMode: 'screen'
          }} />

          {/* 噪点纹理层 */}
          <div className="absolute inset-0" style={{
            opacity: 0.032,
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundSize: '180px 180px'
          }} />

          {/* 动态光晕 A */}
          <div className="absolute rounded-full pointer-events-none" style={{
            width: 300, height: 300, top: -80, left: -80,
            background: 'radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 70%)',
            filter: 'blur(60px)',
            animation: 'login-glowDrift1 16s ease-in-out infinite'
          }} />
          {/* 动态光晕 B */}
          <div className="absolute rounded-full pointer-events-none" style={{
            width: 260, height: 260, bottom: -60, right: -60,
            background: 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)',
            filter: 'blur(60px)',
            animation: 'login-glowDrift2 20s ease-in-out infinite'
          }} />
          {/* 动态光晕 C */}
          <div className="absolute rounded-full pointer-events-none" style={{
            width: 180, height: 180, top: '40%', right: -40,
            background: 'radial-gradient(circle, rgba(56,189,248,0.10) 0%, transparent 70%)',
            filter: 'blur(60px)',
            animation: 'login-glowDrift3 13s ease-in-out infinite'
          }} />

          {/* 扫光线 1 */}
          <div className="absolute pointer-events-none" style={{
            width: 1, height: '100%', top: 0,
            background: 'linear-gradient(to bottom, transparent 0%, rgba(160,140,255,0.15) 50%, transparent 100%)',
            animation: 'login-sweepAcross 12s ease-in-out infinite'
          }} />
          {/* 扫光线 2 */}
          <div className="absolute pointer-events-none" style={{
            width: 1, height: '70%', top: '15%',
            background: 'linear-gradient(to bottom, transparent, rgba(180,160,255,0.10), transparent)',
            animation: 'login-sweepAcross 18s ease-in-out infinite 6s'
          }} />

          {/* 登录卡片 */}
          <div className="relative z-10 w-full max-w-[300px]" style={{
            background: 'rgba(255,255,255,0.06)',
            backdropFilter: 'blur(40px) saturate(160%)',
            WebkitBackdropFilter: 'blur(40px) saturate(160%)',
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,0.12)',
            padding: '40px 36px',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.04) inset, 0 32px 80px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.3)'
          }}>
            {/* 卡片内 logo */}
            <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center mb-6"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                boxShadow: '0 4px 16px rgba(99,102,241,0.4)'
              }}>
              <LogoMark size={18} />
            </div>

            <h2 className="text-[22px] font-bold tracking-[-0.025em] mb-1.5"
              style={{ color: 'rgba(255,255,255,0.93)' }}>
              欢迎回来
            </h2>
            <p className="text-[13px] mb-8 leading-relaxed"
              style={{ color: 'rgba(255,255,255,0.42)' }}>
              使用飞书账号继续
            </p>

            {/* 飞书登录按钮 */}
            <a
              href={getFeishuAuthUrl()}
              className="w-full h-[46px] rounded-xl flex items-center justify-center gap-2.5 text-[14px] font-semibold tracking-[0.01em] transition-all duration-200"
              style={loading ? {
                background: 'rgba(255,255,255,0.35)',
                color: 'rgba(20,86,240,0.5)',
                cursor: 'not-allowed',
                pointerEvents: 'none'
              } : {
                background: 'rgba(255,255,255,0.93)',
                color: '#1456f0'
              }}
              onClick={(e) => loading && e.preventDefault()}
              onMouseEnter={(e) => {
                if (!loading) {
                  (e.currentTarget as HTMLAnchorElement).style.background = '#ffffff'
                  ;(e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-1px)'
                  ;(e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 8px 30px rgba(0,0,0,0.4)'
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.93)'
                  ;(e.currentTarget as HTMLAnchorElement).style.transform = ''
                  ;(e.currentTarget as HTMLAnchorElement).style.boxShadow = ''
                }
              }}
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                      stroke="white" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="white"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  登录中...
                </>
              ) : (
                <>
                  <FeishuIcon />
                  使用飞书账号登录
                </>
              )}
            </a>

            {/* 分割线 */}
            <div className="my-5" style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />

            {/* 版权 */}
            <p className="text-center text-[11px] leading-[1.7]"
              style={{ color: 'rgba(255,255,255,0.25)' }}>
              登录即同意{' '}
              <span style={{ color: 'rgba(160,160,255,0.5)' }}>服务条款</span>
              {' '}与{' '}
              <span style={{ color: 'rgba(160,160,255,0.5)' }}>隐私政策</span>
              <br />© 2025 流光数据中台
            </p>
          </div>
        </motion.div>

      </div>
    </div>
  )
}
```

- [ ] **Step 2：TypeScript 类型检查**

```bash
cd frontend && npm run build 2>&1 | tail -30
```

期望：build 成功，无 TS 错误

- [ ] **Step 3：本地验证**

```bash
cd frontend && npm run dev
```

浏览器访问 `http://localhost:5173/login`，检查：
- [ ] 左右分栏正确显示（宽屏）
- [ ] 右侧深色光影背景可见，3个光晕有漂移动效
- [ ] 光线扫过动效运行
- [ ] 登录卡片毛玻璃效果可见
- [ ] 缩小浏览器至 <1024px，左侧品牌区隐藏（`hidden lg:flex`），右侧自动占满
- [ ] 点击登录按钮正常跳转飞书 OAuth

- [ ] **Step 4：Commit**

```bash
git add frontend/src/pages/Login.tsx
git commit -m "feat: 登录页重设计 — 左右分栏苹果级光影质感"
```

---

## Task 3：最终推送

- [ ] **Step 1：推送到远程**

```bash
git push
```

---

## 验收标准

| 项目 | 通过条件 |
|------|---------|
| 布局 | 宽屏左右分栏，窄屏右侧全屏 |
| 左侧 | Logo + 主标语 + 3个指标 + 状态徽章 |
| 右侧 | 深色底，3层动态光晕，2条扫光线，噪点纹理 |
| 登录卡片 | 毛玻璃效果，Loading 状态样式正确 |
| OAuth | 登录流程与原有完全一致 |
| 构建 | `npm run build` 无错误 |
