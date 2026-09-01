import { describe, expect, it } from "vitest";

import {
  applyPreset,
  ASPECTS,
  BACKGROUNDS,
  LOOKS,
  DEFAULT_SETTINGS,
  dimensions,
  matchPreset,
  OUTPUT_PRESETS,
  plannedOutputs,
  RESOLUTIONS,
  SERVICES,
  toFormData,
  toggleAspect,
  toggleService,
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
      { ...DEFAULT_SETTINGS, fps: 30, resolution: 720, crf: 20 },
      image,
      audio,
    );
    expect(form.get("fps")).toBe("30");
    expect(form.get("resolution")).toBe("720");
    expect(form.get("crf")).toBe("20");
  });

  it("sends one aspect field per aspect, which is how the server reads a list", () => {
    const one = toFormData(DEFAULT_SETTINGS, image, audio);
    expect(one.getAll("aspects")).toEqual(["16:9"]);

    const both = toFormData(
      { ...DEFAULT_SETTINGS, aspects: ["9:16", "16:9"] },
      image,
      audio,
    );
    // ordered, so the server renders the desktop cut first whatever order the
    // buttons were clicked in
    expect(both.getAll("aspects")).toEqual(["16:9", "9:16"]);
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
    expect(DEFAULT_SETTINGS.resolution).toBe(1080);
    expect(DEFAULT_SETTINGS.fps).toBe(60);
    expect(DEFAULT_SETTINGS.hpss).toBe(true);
  });

  it("start on the desktop cut alone, not both", () => {
    expect(DEFAULT_SETTINGS.aspects).toEqual(["16:9"]);
  });
});

describe("dimensions", () => {
  it("reads the resolution as the short edge, whichever way the frame turns", () => {
    expect(dimensions(1080, "16:9")).toEqual({ width: 1920, height: 1080 });
    expect(dimensions(1080, "9:16")).toEqual({ width: 1080, height: 1920 });
  });

  it("derives the whole tier table both ways round", () => {
    const table: Array<[number, number]> = [
      [720, 1280],
      [1080, 1920],
      [1440, 2560],
      [2160, 3840],
    ];
    for (const [short, long] of table) {
      expect(dimensions(short, "16:9")).toEqual({ width: long, height: short });
      expect(dimensions(short, "9:16")).toEqual({ width: short, height: long });
    }
  });

  it("only ever produces edges yuv420p can encode", () => {
    for (const r of RESOLUTIONS) {
      for (const a of ASPECTS) {
        const { width, height } = dimensions(r.short, a.id);
        expect(width % 2, `${r.label} ${a.id} width`).toBe(0);
        expect(height % 2, `${r.label} ${a.id} height`).toBe(0);
      }
    }
  });

  it("covers every tier the panel offers", () => {
    expect(RESOLUTIONS.map((r) => r.short)).toEqual([720, 1080, 1440, 2160]);
  });
});

describe("plannedOutputs", () => {
  it("is one video for one aspect", () => {
    expect(plannedOutputs(DEFAULT_SETTINGS)).toEqual([
      { aspect: "16:9", width: 1920, height: 1080 },
    ]);
  });

  it("is both videos, desktop first, when both are ticked", () => {
    const both = plannedOutputs({ ...DEFAULT_SETTINGS, aspects: ["9:16", "16:9"] });
    expect(both).toEqual([
      { aspect: "16:9", width: 1920, height: 1080 },
      { aspect: "9:16", width: 1080, height: 1920 },
    ]);
  });
});

describe("toggleAspect", () => {
  it("adds an aspect that was off", () => {
    expect(toggleAspect(DEFAULT_SETTINGS, "9:16")).toEqual(["16:9", "9:16"]);
  });

  it("removes an aspect that was on", () => {
    const both = { ...DEFAULT_SETTINGS, aspects: ["16:9", "9:16"] as const };
    expect(toggleAspect({ ...both, aspects: [...both.aspects] }, "16:9")).toEqual([
      "9:16",
    ]);
  });

  it("refuses to switch off the last one, which would render nothing", () => {
    expect(toggleAspect(DEFAULT_SETTINGS, "16:9")).toEqual(["16:9"]);
  });

  it("keeps the desktop cut first however the buttons were clicked", () => {
    const portraitOnly = { ...DEFAULT_SETTINGS, aspects: ["9:16"] as const };
    expect(
      toggleAspect({ ...portraitOnly, aspects: [...portraitOnly.aspects] }, "16:9"),
    ).toEqual(["16:9", "9:16"]);
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
    expect(next.resolution).toBe(2160);
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

  it("leaves the chosen aspects alone, the way it leaves the credit line", () => {
    // which platforms you are cutting for is not something a quality preset
    // gets to reset
    const both = { ...DEFAULT_SETTINGS, aspects: ["16:9", "9:16"] as const };
    for (const preset of OUTPUT_PRESETS) {
      const next = applyPreset({ ...both, aspects: [...both.aspects] }, preset);
      expect(next.aspects).toEqual(["16:9", "9:16"]);
    }
  });

  it("still recognises a preset when both aspects are ticked", () => {
    const both = { ...DEFAULT_SETTINGS, aspects: ["16:9", "9:16"] as const };
    expect(matchPreset({ ...both, aspects: [...both.aspects] })).toBe("deliver");
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
    expect(matchPreset({ ...DEFAULT_SETTINGS, resolution: 720 })).toBeNull();
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

describe("looks", () => {
  it("offers exactly the ones the pipeline registers", () => {
    // must stay in step with viz/looks/index.js and schemas.LOOKS — a look in
    // the picker that the renderer does not know produces a blank video
    expect(LOOKS.map((l) => l.id)).toEqual(["wake", "pyre", "miasma", "chrome", "totem"]);
  });

  it("names and describes each one for the picker", () => {
    for (const look of LOOKS) {
      expect(look.name.length).toBeGreaterThan(0);
      expect(look.note.length).toBeGreaterThan(0);
    }
  });

  it("opens on the look that keeps the artwork most legible", () => {
    expect(DEFAULT_SETTINGS.look).toBe("chrome");
  });

  it("sends the look with the job", () => {
    const form = toFormData({ ...DEFAULT_SETTINGS, look: "pyre" }, image, audio);
    expect(form.get("look")).toBe("pyre");
  });

  it("keeps the look out of the output presets", () => {
    // resolution and quality are what a preset speaks for; which design gets
    // drawn is an orthogonal choice and must survive picking one
    const preset = OUTPUT_PRESETS[2];
    expect(applyPreset({ ...DEFAULT_SETTINGS, look: "totem" }, preset).look).toBe("totem");
    expect(matchPreset({ ...DEFAULT_SETTINGS, look: "totem" })).toBe("deliver");
  });
});

describe("backgrounds", () => {
  it("offers exactly the ones the pipeline registers", () => {
    // must stay in step with viz/backgrounds/index.js and schemas.BACKGROUNDS
    expect(BACKGROUNDS.map((b) => b.id)).toEqual([
      "bloodtide",
      "emberstorm",
      "choke",
      "smelt",
      "storm",
    ]);
  });

  it("names and describes each one for the picker", () => {
    for (const bg of BACKGROUNDS) {
      expect(bg.name.length).toBeGreaterThan(0);
      expect(bg.note.length).toBeGreaterThan(0);
    }
  });

  it("opens on the background paired with the default look", () => {
    expect(DEFAULT_SETTINGS.background).toBe("smelt");
  });

  it("sends the background with the job", () => {
    const form = toFormData({ ...DEFAULT_SETTINGS, background: "storm" }, image, audio);
    expect(form.get("background")).toBe("storm");
  });

  it("keeps the background out of the output presets, for every preset", () => {
    for (const preset of OUTPUT_PRESETS) {
      const next = applyPreset({ ...DEFAULT_SETTINGS, background: "choke" }, preset);
      expect(next.background).toBe("choke");
    }
  });
});

describe("services", () => {
  it("offers exactly the ones the renderer registers", () => {
    // must stay in step with viz/services.js and schemas.SERVICES
    expect(SERVICES.map((s) => s.id)).toEqual([
      "spotify",
      "apple",
      "youtube",
      "soundcloud",
      "bandcamp",
      "tidal",
      "deezer",
      "amazon",
    ]);
  });

  it("names each one for the picker", () => {
    for (const svc of SERVICES) {
      expect(svc.name.length).toBeGreaterThan(0);
    }
  });

  it("starts with nothing picked", () => {
    expect(DEFAULT_SETTINGS.services).toEqual([]);
  });

  it("sends one field per picked service, which is how the server reads a list", () => {
    const form = toFormData(
      { ...DEFAULT_SETTINGS, services: ["apple", "spotify"] },
      image,
      audio,
    );
    expect(form.getAll("services")).toEqual(["apple", "spotify"]);
  });

  it("sends nothing when no service is picked", () => {
    const form = toFormData(DEFAULT_SETTINGS, image, audio);
    expect(form.getAll("services")).toEqual([]);
  });

  it("keeps services out of the output presets, for every preset", () => {
    const picked = { ...DEFAULT_SETTINGS, services: ["tidal", "deezer"] };
    for (const preset of OUTPUT_PRESETS) {
      expect(applyPreset(picked, preset).services).toEqual(["tidal", "deezer"]);
    }
  });

  describe("toggleService", () => {
    it("adds a service that was off", () => {
      expect(toggleService(DEFAULT_SETTINGS, "spotify")).toEqual(["spotify"]);
    });

    it("removes a service that was on", () => {
      const on = { ...DEFAULT_SETTINGS, services: ["spotify", "apple"] };
      expect(toggleService(on, "spotify")).toEqual(["apple"]);
    });

    it("keeps registry order regardless of click order", () => {
      const start = { ...DEFAULT_SETTINGS, services: ["amazon"] };
      // amazon was clicked first, spotify second — spotify still comes first
      expect(toggleService(start, "spotify")).toEqual(["spotify", "amazon"]);
    });
  });
});
