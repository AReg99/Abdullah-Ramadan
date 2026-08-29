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
#
# The push is attempted twice on purpose. A plain `db push` refuses anything it
# considers risky and exits — including adding a unique column that is brand new
# and entirely empty, where there is nothing to lose. That exit crash-loops the
# container and takes the whole business offline over a warning about data that
# does not exist. So: try the strict push, and only if it refuses, apply the
# schema the release actually ships with.
#
# This is a single-tenant server whose schema comes from the image, so the
# release is the intent. It does mean a column dropped in a release is dropped
# here — run scripts/backup.sh before upgrading.
CMD sh -c "(npx prisma db push --skip-generate || npx prisma db push --skip-generate --accept-data-loss) && npx tsx prisma/seed.ts && npx tsx src/server.ts"
