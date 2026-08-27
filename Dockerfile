FROM ghcr.io/puppeteer/puppeteer:22.15.0

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001
CMD ["node", "server.js"]
