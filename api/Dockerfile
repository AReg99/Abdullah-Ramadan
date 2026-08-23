FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
EXPOSE 4000
# db push + seed run at start so a fresh volume comes up populated.
CMD sh -c "npx prisma db push --skip-generate && npx tsx prisma/seed.ts && npx tsx src/server.ts"
