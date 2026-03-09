# Docker 启动指引

本文档说明如何使用 Dockerfile 启动 **AI Influencers on X** 项目。

---

## 前置要求

- 已安装 [Docker](https://docs.docker.com/get-docker/)

---

## 环境变量

项目需要以下环境变量（用于 AI 网络扩展等能力）：

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `GEMINI_API_KEY` | Google Gemini API 密钥 | ✅ 是 |

**获取方式：** 在 [Google AI Studio](https://aistudio.google.com/apikey) 创建 API Key。

---

## 启动方式

### 构建与运行

```bash
# 构建（将 your_key 替换为你的 GEMINI_API_KEY，不配置 AI 功能可省略）
docker build -t ai-influencers --build-arg GEMINI_API_KEY=your_key .

# 运行
docker run -d -p 4173:4173 ai-influencers
```

访问：**http://localhost:4173**

---

## 后台运行 / 停止

```bash
# 后台运行
docker run -d -p 4173:4173 --name ai-influencers ai-influencers

# 停止
docker stop ai-influencers

# 删除容器
docker rm ai-influencers
```

---

## 常见问题

### 端口映射

默认 4173，若要使用 80 端口：`-p 80:4173`

### 构建失败：依赖安装超时

如遇网络问题，可在 Dockerfile 中为 npm 配置国内镜像：

```dockerfile
RUN npm config set registry https://registry.npmmirror.com && npm install
```

### AI 功能不可用

`GEMINI_API_KEY` 需在 **构建时** 通过 `--build-arg` 传入。不传入时应用仍可运行，但 AI 相关功能会静默失效。

---

## 开发模式

本地开发推荐直接运行：

```bash
npm install
npm run dev
```

访问：**http://localhost:3000**
