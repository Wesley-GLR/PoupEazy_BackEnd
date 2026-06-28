FROM node:20-alpine

WORKDIR /app

# Instala dependencias primeiro para aproveitar o cache de camadas.
COPY package*.json ./
RUN npm install --omit=dev

# Copia o restante do codigo.
COPY . .

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "src/server.js"]
