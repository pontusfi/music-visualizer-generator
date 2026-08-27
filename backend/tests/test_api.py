import io
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from app.jobs import JobManager, JobState
from app.main import create_app
from tests.test_jobs import HAPPY, FakeRunner, InlineExecutor, png, wav


@pytest.fixture
def runner():
    return FakeRunner(HAPPY)


@pytest.fixture
def manager(settings, runner):
    return JobManager(settings, runner=runner, executor=InlineExecutor())


@pytest.fixture
def client(settings, manager):
    app = create_app(settings, manager=manager)
    with TestClient(app) as c:
        yield c


def upload(client, *, image=("cover.png", "image/png"), audio=("song.wav", "audio/wav"), **fields):
    data = {"fps": "60", "width": "1280", "height": "720"}
    data.update({k: str(v) for k, v in fields.items()})
    return client.post(
        "/api/jobs",
        files={
            "image": (image[0], png(), image[1]),
            "audio": (audio[0], wav(), audio[1]),
        },
        data=data,
    )


class TestHealth:
    def test_reports_tool_availability(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert set(body["tools"]) >= {"ffmpeg", "chromium", "librosa"}

    def test_reports_the_supported_upload_formats_and_limits(self, client, settings):
        body = client.get("/api/health").json()
        assert ".png" in body["accepts"]["image"]
        assert ".wav" in body["accepts"]["audio"]
        assert body["limits"]["max_image_bytes"] == settings.max_image_bytes


class TestCreateJob:
    def test_accepts_an_upload_and_returns_a_job(self, client):
        r = upload(client, title="Ashes", artist="OLD NIGHT")
        assert r.status_code == 201
        body = r.json()
        assert body["id"]
        assert body["state"] in {"queued", "analyzing", "rendering", "done"}
        assert body["params"]["title"] == "Ashes"

    def test_runs_the_pipeline_for_the_new_job(self, client, runner):
        upload(client)
        assert len(runner.calls) == 2

    def test_rejects_a_missing_audio_file(self, client):
        r = client.post("/api/jobs", files={"image": ("a.png", png(), "image/png")})
        assert r.status_code == 422

    def test_rejects_an_unsupported_image_type(self, client):
        r = upload(client, image=("cover.svg", "image/svg+xml"))
        assert r.status_code == 400
        assert "detail" in r.json()

    def test_rejects_an_oversized_upload(self, client, settings):
        r = client.post(
            "/api/jobs",
            files={
                "image": ("a.png", png(settings.max_image_bytes + 64), "image/png"),
                "audio": ("a.wav", wav(), "audio/wav"),
            },
            data={"fps": "60"},
        )
        assert r.status_code == 400

    def test_rejects_invalid_parameters_with_a_useful_message(self, client):
        # 44100 / 32 is not a whole number of samples per frame
        r = upload(client, fps=32)
        assert r.status_code == 422

    def test_rejects_odd_dimensions(self, client):
        assert upload(client, width=1281).status_code == 422


class TestJobStatus:
    def test_returns_the_current_state(self, client):
        job_id = upload(client).json()["id"]
        body = client.get(f"/api/jobs/{job_id}").json()
        assert body["id"] == job_id
        assert body["state"] == "done"
        assert body["progress"] == 1.0

    def test_exposes_the_tail_of_the_log(self, client):
        job_id = upload(client).json()["id"]
        assert isinstance(client.get(f"/api/jobs/{job_id}").json()["log"], list)

    def test_unknown_job_is_404(self, client):
        assert client.get("/api/jobs/nope").status_code == 404

    def test_lists_jobs(self, client):
        upload(client)
        upload(client)
        assert len(client.get("/api/jobs").json()["jobs"]) == 2

    def test_a_failed_job_reports_its_error(self, settings, runner):
        runner.plan = {"analyze": (["boom"], 1, []), "render": HAPPY["render"]}
        manager = JobManager(settings, runner=runner, executor=InlineExecutor())
        with TestClient(create_app(settings, manager=manager)) as client:
            job_id = upload(client).json()["id"]
            body = client.get(f"/api/jobs/{job_id}").json()
            assert body["state"] == "failed"
            assert body["error"]


class TestVideo:
    def test_serves_the_finished_video(self, client):
        job_id = upload(client).json()["id"]
        r = client.get(f"/api/jobs/{job_id}/video")
        assert r.status_code == 200
        assert r.headers["content-type"] == "video/mp4"

    def test_download_sets_a_readable_filename(self, client):
        job_id = upload(client, title="Ashes", artist="OLD NIGHT").json()["id"]
        r = client.get(f"/api/jobs/{job_id}/video?download=1")
        disposition = r.headers["content-disposition"]
        assert "attachment" in disposition
        assert "OLD NIGHT - Ashes.mp4" in unquote(disposition)

    def test_video_of_an_unfinished_job_is_409(self, settings, runner):
        runner.plan = {"analyze": (["boom"], 1, []), "render": HAPPY["render"]}
        manager = JobManager(settings, runner=runner, executor=InlineExecutor())
        with TestClient(create_app(settings, manager=manager)) as client:
            job_id = upload(client).json()["id"]
            assert client.get(f"/api/jobs/{job_id}/video").status_code == 409

    def test_video_of_an_unknown_job_is_404(self, client):
        assert client.get("/api/jobs/nope/video").status_code == 404


class TestArtwork:
    def test_serves_the_uploaded_artwork_back_for_the_ui(self, client):
        job_id = upload(client).json()["id"]
        r = client.get(f"/api/jobs/{job_id}/artwork")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("image/")


class TestCancelAndDelete:
    def test_cancel_is_accepted(self, client):
        job_id = upload(client).json()["id"]
        assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200

    def test_delete_removes_the_job(self, client):
        job_id = upload(client).json()["id"]
        assert client.delete(f"/api/jobs/{job_id}").status_code == 204
        assert client.get(f"/api/jobs/{job_id}").status_code == 404

    def test_delete_of_an_unknown_job_is_404(self, client):
        assert client.delete("/api/jobs/nope").status_code == 404


class TestEvents:
    def test_streams_server_sent_events_until_the_job_settles(self, client):
        job_id = upload(client).json()["id"]
        with client.stream("GET", f"/api/jobs/{job_id}/events") as r:
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("text/event-stream")
            body = "".join(chunk for chunk in r.iter_text())
        assert "data:" in body
        assert '"state": "done"' in body or '"state":"done"' in body

    def test_events_for_an_unknown_job_is_404(self, client):
        assert client.get("/api/jobs/nope/events").status_code == 404
