# Build context is the repo root: the server drives analyze.py and render.py,
# which live there.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    MVG_PIPELINE_DIR=/app \
    MVG_WORK_DIR=/data/jobs

# ffmpeg does the muxing; the rest are what chromium needs to start headless
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
 && playwright install --with-deps chromium

COPY analyze.py render.py visualizer.html ./
# visualizer.html is a shell; the looks it imports live in viz/
COPY viz ./viz
COPY backend ./backend

RUN mkdir -p /data/jobs
WORKDIR /app/backend
EXPOSE 8000

# --factory: the app is built per process, so nothing is constructed at import
CMD ["uvicorn", "app.main:create_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "75"]
