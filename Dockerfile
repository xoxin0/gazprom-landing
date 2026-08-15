# Зависимостей у проекта нет — образ собирается из одного слоя с исходниками
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY server ./server
COPY css ./css
COPY js ./js
COPY pages ./pages
COPY assets ./assets
COPY index.html ./

# Каталог состояния должен быть доступен на запись процессу node
RUN mkdir -p server/data && chown -R node:node /app

USER node

EXPOSE 8080
ENV PORT=8080

CMD ["node", "server/server.js"]
