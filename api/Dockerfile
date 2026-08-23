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
# Schema push is safe to repeat; the seed no-ops once the database has data
# (SEED_IF_EMPTY), so restarting a container never wipes a trial.
CMD sh -c "npx prisma db push --skip-generate && npx tsx prisma/seed.ts && npx tsx src/server.ts"
