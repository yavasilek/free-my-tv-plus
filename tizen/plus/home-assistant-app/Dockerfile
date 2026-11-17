FROM mcr.microsoft.com/playwright:v1.61.1-noble

RUN apt-get update \
    && apt-get install -y --no-install-recommends jq nginx novnc tini websockify x11-utils x11vnc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm install --omit=dev --no-save --ignore-scripts playwright@1.61.1
COPY myshows-browser.mjs myshows-catalog.mjs /app/
COPY login.html /app/
COPY ingress.conf /etc/nginx/conf.d/ingress.conf
COPY run.sh /app/run.sh

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/bin/sh", "/app/run.sh"]
