# NodeByte WebSocket 信令服务
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY index.mjs .
EXPOSE 8081 8181
CMD ["node", "index.mjs"]
