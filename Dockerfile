FROM node:20-alpine

# Install nginx and supervisor
RUN apk add --no-cache nginx supervisor

# API server setup
WORKDIR /api
COPY api/package.json ./
RUN npm install --production
COPY api/server.js ./

# Static files
COPY . /usr/share/nginx/html/
RUN mkdir -p /run/nginx
COPY nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisord.conf

EXPOSE 80
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisord.conf"]
