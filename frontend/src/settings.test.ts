import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, toFormData } from "./settings";

const image = new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" });
const audio = new File([new Uint8Array([4, 5, 6])], "track.wav", { type: "audio/wav" });

describe("toFormData", () => {
  it("carries both files under the names the server expects", () => {
    const form = toFormData(DEFAULT_SETTINGS, image, audio);
    expect((form.get("image") as File).name).toBe("cover.png");
    expect((form.get("audio") as File).name).toBe("track.wav");
  });

  it("sends the render parameters as strings", () => {
    const form = toFormData(
      { ...DEFAULT_SETTINGS, fps: 30, width: 1280, height: 720, crf: 20 },
      image,
      audio,
    );
    expect(form.get("fps")).toBe("30");
    expect(form.get("width")).toBe("1280");
    expect(form.get("height")).toBe("720");
    expect(form.get("crf")).toBe("20");
  });

  it("omits the preview window unless it is switched on", () => {
    const form = toFormData(DEFAULT_SETTINGS, image, audio);
    expect(form.get("preview_start")).toBeNull();
    expect(form.get("preview_end")).toBeNull();
  });

  it("sends the preview window when it is switched on", () => {
    const form = toFormData(
      { ...DEFAULT_SETTINGS, previewEnabled: true, previewStart: 30, previewEnd: 45 },
      image,
      audio,
    );
    expect(form.get("preview_start")).toBe("30");
    expect(form.get("preview_end")).toBe("45");
  });

  it("sends the harmonic/percussive split as a boolean the server understands", () => {
    expect(toFormData({ ...DEFAULT_SETTINGS, hpss: false }, image, audio).get("hpss")).toBe(
      "false",
    );
    expect(toFormData(DEFAULT_SETTINGS, image, audio).get("hpss")).toBe("true");
  });

  it("trims the credit line", () => {
    const form = toFormData(
      { ...DEFAULT_SETTINGS, artist: "  OLD NIGHT ", title: " Ashes " },
      image,
      audio,
    );
    expect(form.get("artist")).toBe("OLD NIGHT");
    expect(form.get("title")).toBe("Ashes");
  });
});

describe("defaults", () => {
  it("start at 1080p60, which is what the README calls the real render", () => {
    expect(DEFAULT_SETTINGS.width).toBe(1920);
    expect(DEFAULT_SETTINGS.height).toBe(1080);
    expect(DEFAULT_SETTINGS.fps).toBe(60);
    expect(DEFAULT_SETTINGS.hpss).toBe(true);
  });
});
