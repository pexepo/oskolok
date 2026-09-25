FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html ./
COPY src ./src
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4100
COPY --from=build /app/dist ./dist
COPY server.mjs package.json ./
USER node
EXPOSE 4100
CMD ["node", "server.mjs"]
