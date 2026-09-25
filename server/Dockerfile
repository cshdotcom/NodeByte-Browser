# NodeByte Server（Next.js standalone）多阶段构建
# 产物 .next/standalone 含 server.js，静态资源 .next/static 需一并拷贝（提示词 C.2）
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# standalone 产物
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# 引导脚本与 SQL（首启初始化用）
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/sql ./sql
EXPOSE 3000
CMD ["node", "server.js"]
