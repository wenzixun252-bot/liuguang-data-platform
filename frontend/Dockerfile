# ── Stage 1: Build ──
FROM node:20-alpine AS builder

WORKDIR /app

# 接收构建参数，Vite 在 build 时静态替换 import.meta.env
ARG VITE_FEISHU_APP_ID
ARG VITE_FEISHU_REDIRECT_URI
ENV VITE_FEISHU_APP_ID=$VITE_FEISHU_APP_ID
ENV VITE_FEISHU_REDIRECT_URI=$VITE_FEISHU_REDIRECT_URI

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Nginx ──
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
