FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public/

VOLUME ["/app/data"]
ENV DB_PATH=/app/data/yazaki-db.json

EXPOSE 8080

CMD ["node", "server.js"]
