# Stage 1: 构建阶段
# 使用 Node.js 镜像作为构建环境（Debian 基础，兼容性更好）
FROM node:20-bullseye-slim AS builder

WORKDIR /app

# 复制依赖文件并安装，利用 Docker 缓存
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# 复制项目所有文件
COPY . .

# 构建时传入的环境变量（Vite 内联到前端）
ARG GEMINI_API_KEY
ENV GEMINI_API_KEY=$GEMINI_API_KEY

# 运行 Vite 构建（使用 npx 确保找到本地 vite）
RUN npx vite build

# Stage 2: 生产阶段
# 使用轻量 Node 镜像作为生产环境
FROM node:20-bullseye-slim

WORKDIR /app

# 复制 package.json 以便运行 preview 命令
COPY package.json ./

# 从构建阶段复制 node_modules 和 dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# 暴露端口
EXPOSE 4173

# 启动 Vite 预览服务（托管构建产物）
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
