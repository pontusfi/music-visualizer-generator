"""Request/response shapes. The render parameters validate themselves."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

X264_PRESETS = (
    "ultrafast",
    "superfast",
    "veryfast",
    "faster",
    "fast",
    "medium",
    "slow",
    "slower",
    "veryslow",
)

Preset = Literal[
    "ultrafast",
    "superfast",
    "veryfast",
    "faster",
    "fast",
    "medium",
    "slow",
    "slower",
    "veryslow",
]


class JobParams(BaseModel):
    """Everything the two pipeline stages need, other than the files."""

    model_config = {"extra": "forbid"}

    fps: int = Field(default=60, ge=1, le=120)
    sample_rate: int = Field(default=44100, ge=8000, le=192000)
    width: int = Field(default=1920, ge=256, le=7680)
    height: int = Field(default=1080, ge=256, le=4320)
    title: str = Field(default="", max_length=120)
    artist: str = Field(default="", max_length=120)
    crf: int = Field(default=16, ge=0, le=51)
    preset: Preset = "slow"
    bands: int = Field(default=24, ge=4, le=64)
    hpss: bool = True
    preview_start: float | None = Field(default=None, ge=0)
    preview_end: float | None = Field(default=None, ge=0)

    @field_validator("title", "artist")
    @classmethod
    def _tidy_text(cls, v: str) -> str:
        # these end up in an argv and on screen; newlines help nobody
        return " ".join(v.split())

    @model_validator(mode="after")
    def _check(self) -> "JobParams":
        if self.width % 2 or self.height % 2:
            raise ValueError("width and height must be even for yuv420p output")
        if self.sample_rate % self.fps:
            raise ValueError(
                f"{self.sample_rate} Hz does not divide evenly by {self.fps} fps; "
                "analysis frames would drift out of step with video frames. "
                "Try 30 or 60 fps."
            )
        if (self.preview_start is None) != (self.preview_end is None):
            raise ValueError("preview_start and preview_end must be given together")
        if self.preview_start is not None and self.preview_end is not None:
            if self.preview_end <= self.preview_start:
                raise ValueError("preview_end must be greater than preview_start")
        return self

    def preview_range(self) -> tuple[float, float] | None:
        if self.preview_start is None or self.preview_end is None:
            return None
        return (self.preview_start, self.preview_end)
