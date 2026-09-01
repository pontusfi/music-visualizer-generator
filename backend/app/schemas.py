"""Request/response shapes. The render parameters validate themselves."""

from __future__ import annotations

from dataclasses import dataclass
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

Aspect = Literal["16:9", "9:16"]

#: aspect -> (key, width ratio, height ratio). The key names the output in URLs
#: and on disk; ":" is not a filename or query-string character worth fighting.
ASPECTS: dict[str, tuple[str, int, int]] = {
    "16:9": ("landscape", 16, 9),
    "9:16": ("portrait", 9, 16),
}


def _even(value: float) -> int:
    """yuv420p subsamples chroma, so both edges have to be even."""
    return int(round(value / 2)) * 2


@dataclass(frozen=True)
class Output:
    """One video a job will produce."""

    key: str
    aspect: str
    width: int
    height: int

    @property
    def filename(self) -> str:
        return f"out-{self.key}.mp4"

    @property
    def suffix(self) -> str:
        """What tells two downloads of the same track apart."""
        return f" ({self.aspect.replace(':', 'x')})"


#: the looks viz/looks/index.js registers. Kept here as well so a typo is a
#: 422 at upload time rather than a blank video forty minutes later.
LOOKS = ("wake", "pyre", "miasma", "chrome", "totem")

Look = Literal["wake", "pyre", "miasma", "chrome", "totem"]

#: the backgrounds viz/backgrounds/index.js registers. Same reasoning as
#: LOOKS: a typo here is a 422, not a render that quietly used the default.
BACKGROUNDS = ("bloodtide", "emberstorm", "choke", "smelt", "storm")

Background = Literal["bloodtide", "emberstorm", "choke", "smelt", "storm"]

#: the services viz/services.js registers. Order here has no effect on the
#: badge row — that always follows the registry in services.js — but it does
#: have to name every id that registry knows about, or a legitimate choice
#: gets refused.
SERVICES = ("spotify", "apple", "youtube", "soundcloud", "bandcamp", "tidal", "deezer", "amazon")

Service = Literal[
    "spotify", "apple", "youtube", "soundcloud", "bandcamp", "tidal", "deezer", "amazon"
]


class JobParams(BaseModel):
    """Everything the two pipeline stages need, other than the files."""

    model_config = {"extra": "forbid"}

    fps: int = Field(default=60, ge=1, le=120)
    sample_rate: int = Field(default=44100, ge=8000, le=192000)
    #: the SHORT edge of the frame, so one number covers both orientations:
    #: 1080 is 1920x1080 landscape and 1080x1920 portrait
    resolution: int = Field(default=1080, ge=256, le=4320)
    aspects: list[Aspect] = Field(
        default_factory=lambda: ["16:9"], min_length=1, max_length=len(ASPECTS)
    )
    title: str = Field(default="", max_length=120)
    artist: str = Field(default="", max_length=120)
    crf: int = Field(default=16, ge=0, le=51)
    preset: Preset = "slow"
    look: Look = "chrome"
    background: Background = "smelt"
    services: list[Service] = Field(default_factory=list, max_length=len(SERVICES))
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
        if self.resolution % 2:
            raise ValueError("resolution must be even for yuv420p output")
        if len(set(self.aspects)) != len(self.aspects):
            raise ValueError("each aspect ratio can only be rendered once")
        if len(set(self.services)) != len(self.services):
            raise ValueError("each streaming service can only be picked once")
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

    def outputs(self) -> list[Output]:
        """The videos this job will render, in the order it will render them."""
        made = []
        for aspect in self.aspects:
            key, wr, hr = ASPECTS[aspect]
            scale = self.resolution / min(wr, hr)
            made.append(
                Output(
                    key=key,
                    aspect=aspect,
                    width=_even(wr * scale),
                    height=_even(hr * scale),
                )
            )
        return made

    def preview_range(self) -> tuple[float, float] | None:
        if self.preview_start is None or self.preview_end is None:
            return None
        return (self.preview_start, self.preview_end)
