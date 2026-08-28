import { describe, expect, it } from "vitest";

import {
  applyPreset,
  DEFAULT_SETTINGS,
  matchPreset,
  OUTPUT_PRESETS,
  toFormData,
} from "./settings";

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

describe("output presets", () => {
  const byId = (id: string) => {
    const preset = OUTPUT_PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error(`no preset ${id}`);
    return preset;
  };

  it("offers a test window, a delivery and a master", () => {
    expect(OUTPUT_PRESETS.map((p) => p.id)).toEqual(["test", "deliver", "master"]);
  });

  it("opens on Delivery, so the defaults are a named preset and not 'custom'", () => {
    expect(matchPreset(DEFAULT_SETTINGS)).toBe("deliver");
  });

  it("carries every field the preset names onto the settings", () => {
    const next = applyPreset(DEFAULT_SETTINGS, byId("master"));
    expect(next.width).toBe(3840);
    expect(next.height).toBe(2160);
    expect(next.fps).toBe(60);
    expect(next.crf).toBe(14);
    expect(next.preset).toBe("slower");
  });

  it("leaves the credit line and the analysis settings alone", () => {
    const start = { ...DEFAULT_SETTINGS, artist: "OLD NIGHT", title: "Ashes", bands: 40 };
    const next = applyPreset(start, byId("master"));
    expect(next.artist).toBe("OLD NIGHT");
    expect(next.title).toBe("Ashes");
    expect(next.bands).toBe(40);
    expect(next.hpss).toBe(true);
  });

  it("switches the test window on for the test preset and off for the others", () => {
    expect(applyPreset(DEFAULT_SETTINGS, byId("test")).previewEnabled).toBe(true);
    expect(applyPreset(DEFAULT_SETTINGS, byId("deliver")).previewEnabled).toBe(false);
  });

  it("keeps the window the user chose when switching to the test preset", () => {
    const start = { ...DEFAULT_SETTINGS, previewStart: 120, previewEnd: 140 };
    const next = applyPreset(start, byId("test"));
    expect(next.previewStart).toBe(120);
    expect(next.previewEnd).toBe(140);
  });

  it("recognises its own output, so the button lights up after a click", () => {
    for (const preset of OUTPUT_PRESETS) {
      expect(matchPreset(applyPreset(DEFAULT_SETTINGS, preset))).toBe(preset.id);
    }
  });

  it("goes custom the moment a single field diverges", () => {
    expect(matchPreset({ ...DEFAULT_SETTINGS, crf: 23 })).toBeNull();
    expect(matchPreset({ ...DEFAULT_SETTINGS, fps: 30 })).toBeNull();
    expect(matchPreset({ ...DEFAULT_SETTINGS, preset: "veryfast" })).toBeNull();
    expect(matchPreset({ ...DEFAULT_SETTINGS, height: 720, width: 1280 })).toBeNull();
  });

  it("does not confuse the test preset with a 720p render of the whole track", () => {
    const full = applyPreset(DEFAULT_SETTINGS, byId("test"));
    expect(matchPreset({ ...full, previewEnabled: false })).toBeNull();
  });

  it("names every preset with a spec line the panel can print", () => {
    for (const preset of OUTPUT_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.spec.length).toBeGreaterThan(0);
    }
  });
});
