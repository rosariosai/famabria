# Famabria reminders: reads the family's notes as a read-only device and posts due reminders to ntfy.
# No dependencies, no build step. Image: ghcr.io/rosariosai/famabria-reminders
FROM node:20-alpine
ENV NODE_ENV=production STATE_FILE=/data/state.json
WORKDIR /app
COPY famabria-reminders.mjs ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
CMD ["node", "famabria-reminders.mjs"]
