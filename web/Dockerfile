# Callan Operational Dashboard v2 - static dashboard + reverse proxy to the API
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Pre-render the nginx configuration at build time instead of runtime
# This avoids permission issues with tmpfs mounts
ENV API_UPSTREAM=api:8000
COPY nginx/default.conf.template /etc/nginx/conf.d/default.conf.template
RUN envsubst '$API_UPSTREAM' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && \
    rm /etc/nginx/conf.d/default.conf.template
COPY html/ /usr/share/nginx/html/

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/nginx-health || exit 1
