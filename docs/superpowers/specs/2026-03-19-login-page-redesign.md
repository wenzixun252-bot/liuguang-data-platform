# 登录页重设计规格文档

**日期：** 2026-03-19
**状态：** 已批准
**目标：** 将现有登录页升级为苹果级高级质感，消除背景空洞感，增加品牌表达力和动效

---

## 一、布局结构

**左右分栏**，整体为卡片式，圆角 `rounded-3xl`，外部有 `shadow-2xl` 阴影浮起效果。

| 区域 | 宽度 | 职责 |
|------|------|------|
| 左侧品牌区 | 55% | Logo、产品主标语、核心指标、系统状态 |
| 右侧登录区 | 45% | 深色光影背景 + 毛玻璃登录卡片 |

---

## 二、左侧品牌区

**背景：** 纯白 `#ffffff`，右下角 + 左上角各一个极淡的 radial-gradient 光晕（透明度 ≤ 8%），不抢眼、有空间感。

**Logo：**
- 方形 logo mark（36×36px，`rounded-[10px]`），渐变色 `indigo-500 → purple-500`
- 内嵌 SVG（20×20 viewBox）：
  ```svg
  <path d="M4 13 Q10 3 16 7" stroke="white" stroke-width="2" stroke-linecap="round"/>
  <path d="M4 7 Q10 17 16 13" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
  <circle cx="10" cy="10" r="1.5" fill="white"/>
  ```
- 旁边文字：「流光数据中台」，`font-semibold text-[17px]`

**主文案区：**
```
Enterprise Data Platform                    ← 小标签，indigo 色，uppercase，12px
连接飞书生态                                ← 主标题，38px bold，
让数据真正「流动」                             「流动」二字渐变色 indigo→purple
集合文档、会议、多维表格，经由智能 ETL          ← 副文案，15px，gray-500
清洗、向量化存储与知识图谱构建，
驱动 AI 问答与业务洞察。
```

**核心指标（3列）：**
- 7 步 ETL 流水线
- 4 个行业提取模板
- 1024 维向量嵌入

**底部状态栏：**
- 绿色脉冲圆点 + 「系统运行正常」
- 进入动画：从左淡入滑入

---

## 三、右侧登录区

### 背景层（纯 CSS，无插画）

| 层 | 实现方式 | 效果 |
|----|---------|------|
| 底色 | `background: #0a0a14` | 深邃暗色 |
| 主光源 | `radial-gradient` 左上蓝紫，70% ellipse | 摄影棚散景感 |
| 辅光 | `radial-gradient` 右下紫，60% ellipse | 色彩纵深 |
| 冷光 | `radial-gradient` 右上天蓝，40% ellipse | 层次感 |
| 动态光晕 | 3个 `div`，`filter: blur(60px)`，CSS keyframes 漂移 | 呼吸感 |
| 光线扫过 | 2条垂直 gradient 线，`sweepAcross` 12s/18s 循环 | 流光感 |
| 噪点纹理 | SVG feTurbulence filter，opacity 3% | 照片颗粒质感 |

**动效参数：**
- 光晕漂移：`translate ±20-30px`，16-20s 无限循环，`ease-in-out`
- 光线扫过：从左到右，12s/18s，错开 6s 相位差

### 登录卡片

- `background: rgba(255,255,255,0.06)`
- `backdrop-filter: blur(40px) saturate(160%)`
- `border: 1px solid rgba(255,255,255,0.12)`
- `border-radius: 20px`，内边距 `40px 36px`
- `box-shadow: 0 32px 80px rgba(0,0,0,0.6)`

**卡片内容（从上至下）：**
1. 小 logo mark（34×34px）
2. 标题「欢迎回来」—— `text-[22px] font-bold`，白色 93% 透明
3. 副标「使用飞书账号继续」—— `text-[13px]`，白色 42% 透明
4. 飞书登录按钮：白色底，蓝色字，圆角 12px，hover 上浮 + 光晕
5. 分割线：`rgba(255,255,255,0.08)`
6. 版权 + 条款链接：白色 25% 透明

---

## 四、动效规格

| 元素 | 动效 | 参数 |
|------|------|------|
| 左侧整体 | `fadeSlideLeft` 淡入 | 0.8s, cubic-bezier(0.22,1,0.36,1) |
| 右侧整体 | `fadeSlideRight` 淡入 | 0.8s, delay 0.1s |
| 状态绿点 | `pulse` 呼吸 | 2s, ease-in-out, infinite |
| 右侧光晕 A/B/C | `glowDrift` 漂移 | 16/20/13s, infinite |
| 光线扫过 1/2 | `sweepAcross` 从左到右 | 12/18s, infinite |

---

## 五、技术实现

**文件：** `frontend/src/pages/Login.tsx`（改写现有组件）

**依赖：**
- `framer-motion`（已存在）—— 页面进入动画（`fadeSlideLeft` / `fadeSlideRight`）
- CSS keyframes —— 背景光晕漂移与扫光线写入 `frontend/src/index.css`（全局样式表），命名空间前缀 `login-` 防冲突
- Tailwind CSS —— 布局与样式

**无需新增依赖。**

**按钮状态规格：**

| 状态 | 背景色 | 文字色 | 其他 |
|------|--------|--------|------|
| 默认 | `rgba(255,255,255,0.93)` | `#1456f0` | — |
| Hover | `#ffffff` | `#1456f0` | `translateY(-1px)` + 阴影增强 |
| Loading/禁用 | `rgba(255,255,255,0.35)` | `rgba(20,86,240,0.5)` | `cursor-not-allowed`，spinner 白色 |

**移动端断点：** `lg:` (1024px)
- ≥1024px：左右分栏
- <1024px：单列，右侧深色区域作为全屏背景，登录卡片居中浮于上方

---

## 六、不在范围内

- 登录逻辑、OAuth 流程不变
- 移动端适配（现有堆叠布局保持不变）
- 深色模式切换
