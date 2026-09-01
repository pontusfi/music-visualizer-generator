"""HTTP surface: upload two files, watch a bar, download an mp4."""

from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError as PydanticValidationError

from .config import Settings
from .jobs import JobManager, ValidationError
from .pipeline import AUDIO_EXTS, IMAGE_EXTS, tool_availability
from .schemas import JobParams

log = logging.getLogger("mvg.api")

#: how often the event stream re-reads job state
POLL_SECONDS = 0.35
#: how often finished jobs are swept off disk
SWEEP_SECONDS = 300


def _optional(value: str | None) -> str | None:
    """Treat an empty form field as absent — browsers send "" for blanks."""
    if value is None:
        return None
    value = value.strip()
    return value or None


def create_app(settings: Settings | None = None, manager: JobManager | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    manager = manager or JobManager(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        sweeper = asyncio.create_task(_sweep(manager))
        try:
            yield
        finally:
            sweeper.cancel()
            await run_in_threadpool(manager.shutdown)

    app = FastAPI(title="Music Visualizer Generator", version="1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.manager = manager
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def get_manager() -> JobManager:
        return app.state.manager

    def require_job(job_id: str, mgr: JobManager):
        job = mgr.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="no such job")
        return job

    # -- meta --------------------------------------------------------------
    @app.get("/api/health")
    async def health():
        tools = await run_in_threadpool(tool_availability)
        return {
            "status": "ok",
            "tools": tools,
            "accepts": {
                "image": sorted(IMAGE_EXTS),
                "audio": sorted(AUDIO_EXTS),
            },
            "limits": {
                "max_image_bytes": settings.max_image_bytes,
                "max_audio_bytes": settings.max_audio_bytes,
                "sample_rate": settings.sample_rate,
            },
        }

    # -- jobs --------------------------------------------------------------
    @app.post("/api/jobs", status_code=201)
    async def create_job(
        request: Request,
        image: UploadFile = File(...),
        audio: UploadFile = File(...),
        fps: int = Form(60),
        resolution: int = Form(1080),
        aspects: list[str] = Form(["16:9"]),
        title: str = Form(""),
        artist: str = Form(""),
        crf: int = Form(16),
        preset: str = Form("slow"),
        bands: int = Form(24),
        hpss: bool = Form(True),
        look: str = Form("chrome"),
        background: str = Form("smelt"),
        services: list[str] = Form([]),
        preview_start: str | None = Form(None),
        preview_end: str | None = Form(None),
        mgr: JobManager = Depends(get_manager),
    ):
        try:
            params = JobParams(
                fps=fps,
                sample_rate=settings.sample_rate,
                resolution=resolution,
                aspects=aspects,
                title=title,
                artist=artist,
                crf=crf,
                preset=preset,
                bands=bands,
                hpss=hpss,
                look=look,
                background=background,
                services=services,
                preview_start=_optional(preview_start),
                preview_end=_optional(preview_end),
            )
        except PydanticValidationError as exc:
            raise HTTPException(status_code=422, detail=_readable(exc)) from exc

        image.file.seek(0)
        audio.file.seek(0)
        try:
            job = await run_in_threadpool(
                mgr.create,
                params,
                (image.filename or "", image.file),
                (audio.filename or "", audio.file),
            )
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        mgr.submit(job.id)
        return job.public()

    @app.get("/api/jobs")
    async def list_jobs(mgr: JobManager = Depends(get_manager)):
        return {"jobs": [job.public(log_lines=0) for job in mgr.list()]}

    @app.get("/api/jobs/{job_id}")
    async def job_status(job_id: str, mgr: JobManager = Depends(get_manager)):
        return require_job(job_id, mgr).public()

    @app.get("/api/jobs/{job_id}/events")
    async def job_events(job_id: str, request: Request, mgr: JobManager = Depends(get_manager)):
        require_job(job_id, mgr)

        async def stream():
            last: str | None = None
            while True:
                if await request.is_disconnected():
                    return
                job = mgr.get(job_id)
                if job is None:
                    yield "event: gone\ndata: {}\n\n"
                    return
                payload = json.dumps(job.public(log_lines=20))
                if payload != last:
                    yield f"data: {payload}\n\n"
                    last = payload
                if job.state.terminal:
                    return
                await asyncio.sleep(POLL_SECONDS)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/jobs/{job_id}/video")
    async def job_video(
        job_id: str,
        variant: str | None = None,
        download: int = 0,
        mgr: JobManager = Depends(get_manager),
    ):
        job = require_job(job_id, mgr)
        if variant is None:
            # no aspect named: whichever finished first, which is the only one
            # for the single-output job the UI used to make
            output = next((o for o in job.outputs if o.done), None)
        else:
            output = job.output(variant)
            if output is None:
                raise HTTPException(
                    status_code=404, detail=f"this job has no {variant!r} video"
                )
        if output is None or not output.done or not output.path.exists():
            raise HTTPException(status_code=409, detail=f"job is {job.state.value}")
        kwargs = {"filename": mgr.download_name(job, output)} if download else {}
        return FileResponse(output.path, media_type="video/mp4", **kwargs)

    @app.get("/api/jobs/{job_id}/artwork")
    async def job_artwork(job_id: str, mgr: JobManager = Depends(get_manager)):
        job = require_job(job_id, mgr)
        path = job.dir / job.artwork_name
        if not path.exists():
            raise HTTPException(status_code=404, detail="artwork is gone")
        media_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        return FileResponse(path, media_type=media_type)

    @app.get("/api/jobs/{job_id}/log", response_class=JSONResponse)
    async def job_log(job_id: str, mgr: JobManager = Depends(get_manager)):
        return {"log": require_job(job_id, mgr).log}

    @app.post("/api/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str, mgr: JobManager = Depends(get_manager)):
        require_job(job_id, mgr)
        job = await run_in_threadpool(mgr.cancel, job_id)
        return job.public() if job else {"id": job_id, "state": "gone"}

    @app.delete("/api/jobs/{job_id}", status_code=204)
    async def delete_job(job_id: str, mgr: JobManager = Depends(get_manager)):
        require_job(job_id, mgr)
        await run_in_threadpool(mgr.delete, job_id)
        return None

    # -- optionally serve the built frontend from the same origin ----------
    if settings.static_dir and settings.static_dir.is_dir():
        app.mount(
            "/", StaticFiles(directory=str(settings.static_dir), html=True), name="static"
        )

    return app


def _readable(exc: PydanticValidationError) -> str:
    parts = []
    for err in exc.errors():
        field = ".".join(str(p) for p in err["loc"]) or "request"
        parts.append(f"{field}: {err['msg']}")
    return "; ".join(parts)


async def _sweep(manager: JobManager) -> None:
    while True:
        await asyncio.sleep(SWEEP_SECONDS)
        try:
            removed = await run_in_threadpool(manager.purge)
            if removed:
                log.info("swept %d finished job(s)", len(removed))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("sweep failed")

