# GoRouteX planning service: VROOM + in-process OSRM (Singapore). Built by Cloud Build, run on Cloud Run.

# 1. VROOM without built-in routing: the service passes a custom duration matrix from OSRM.
FROM debian:bookworm-slim AS vroom
ARG VROOM_VERSION=v1.14.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git g++ make \
 && git clone --depth 1 --branch ${VROOM_VERSION} --recurse-submodules --shallow-submodules https://github.com/VROOM-Project/vroom.git /vroom \
 && cd /vroom/src && make -j"$(nproc)" USE_ROUTING=false

# 2. Node dependencies (prebuilt OSRM binding and tools).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 3. Singapore road network, preprocessed for OSRM (multi-level Dijkstra).
FROM deps AS map
ARG OSM_URL=https://download.bbbike.org/osm/bbbike/Singapore/Singapore.osm.pbf
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && mkdir -p /data && curl -fsSL "$OSM_URL" -o /data/singapore.osm.pbf \
 && B=$(dirname "$(find node_modules/@project-osrm/osrm/lib -name osrm-extract | head -1)") \
 && "$B/osrm-extract" -p node_modules/@project-osrm/osrm/profiles/car.lua /data/singapore.osm.pbf \
 && "$B/osrm-partition" /data/singapore.osrm \
 && "$B/osrm-customize" /data/singapore.osrm \
 && rm /data/singapore.osm.pbf

# 4. Runtime.
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=map /data /data
COPY --from=vroom /vroom/bin/vroom /usr/local/bin/vroom
COPY package.json server.mjs ./
ENV NODE_ENV=production OSRM_DATA=/data/singapore.osrm VROOM_BIN=/usr/local/bin/vroom PORT=8080
USER node
CMD ["node", "server.mjs"]
