# Callan Operational Dashboard v2 - static dashboard + reverse proxy to the API
FROM nginxinc/nginx-unprivileged:1.27-alpine

# The image renders /etc/nginx/templates/*.template with envsubst at start-up (only API_* variables).
ENV API_UPSTREAM=api:8000 \
    NGINX_ENVSUBST_FILTER=^API_
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY html/ /usr/share/nginx/html/

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/nginx-health || exit 1
