FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci && npm cache clean --force

COPY . .

RUN npm run build
RUN npx prisma generate
RUN npm prune --omit=dev

CMD ["sh", "-c", "HOST=0.0.0.0 npm run docker-start"]
