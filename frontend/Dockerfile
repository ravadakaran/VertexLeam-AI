FROM node:24-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY frontend ./frontend
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 8080;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]

