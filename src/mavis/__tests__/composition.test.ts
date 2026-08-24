// Cover for the HTML timeline a production renders from.
//
// This module carries more test weight than the rest of the pipeline because
// the render service does not exist yet: there is no finished video to look at,
// so the composition's correctness is established here or not at all.
//
// Two failure classes matter most. Timing errors do not break the render — they
// desynchronise every caption and voiceover from its picture, which only shows
// up when someone watches the output. And escaping errors let model-written
// caption text corrupt or inject into the document.
import { describe, it, expect } from "vitest";
import {
  buildComposition,
  beatTimeline,
  escapeHtml,
  escapeUrl,
  MAX_DECLARED_ASSETS,
  DEFAULT_FPS,
  type CompositionBeat,
  type CompositionInput,
} from "../../../supabase/functions/_shared/composition";

function beat(over: Partial<CompositionBeat> = {}): CompositionBeat {
  return {
    idx: 0,
    narration: "a spoken line",
    on_screen_text: "",
    seconds: 4,
    asset_url: "https://cdn.test/img.png",
    audio_url: "https://cdn.test/voice.mp3",
    ...over,
  };
}

function input(over: Partial<CompositionInput> = {}): CompositionInput {
  return {
    production_id: "prod-1",
    title: "Renal Physiology",
    format: "9:16",
    visual_mode: "stills",
    beats: [beat({ idx: 0 })],
    ...over,
  };
}

describe("beatTimeline", () => {
  it("accumulates start times so beats run back to back", () => {
    const t = beatTimeline([
      beat({ seconds: 3 }), beat({ seconds: 4.5 }), beat({ seconds: 2 }),
    ]);
    expect(t.map((x) => x.start)).toEqual([0, 3, 7.5]);
    expect(t.map((x) => x.duration)).toEqual([3, 4.5, 2]);
  });

  it("leaves no gap or overlap between consecutive beats", () => {
    const beats = [1.3, 2.7, 4.1, 0.9].map((s) => beat({ seconds: s }));
    const t = beatTimeline(beats);
    for (let i = 1; i < t.length; i++) {
      expect(t[i].start).toBeCloseTo(t[i - 1].start + t[i - 1].duration, 3);
    }
  });

  it("survives a zero or negative duration rather than stalling the timeline", () => {
    const t = beatTimeline([beat({ seconds: 0 }), beat({ seconds: -2 }), beat({ seconds: 3 })]);
    expect(t.every((x) => x.duration > 0)).toBe(true);
    expect(t[2].start).toBeGreaterThan(0);
  });

  it("handles an empty production without throwing", () => {
    expect(beatTimeline([])).toEqual([]);
  });
});

describe("escaping", () => {
  it("neutralizes markup in caption text", () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("escapes ampersands, which signed URLs are full of", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("keeps a signed URL intact but attribute-safe", () => {
    const signed = "https://x.supabase.co/storage/v1/object/sign/a.png?token=ab&expires=99";
    const out = escapeUrl(signed)!;
    expect(out).toContain("&amp;expires=99");
    // No bare ampersand survives — one would truncate the attribute and the
    // asset would silently fail to load.
    expect(out.match(/&(?!amp;|quot;|#39;|lt;|gt;)/)).toBeNull();
  });

  it("refuses script-bearing URL schemes outright", () => {
    expect(escapeUrl("javascript:alert(1)")).toBeNull();
    expect(escapeUrl("  JavaScript:alert(1)")).toBeNull();
    expect(escapeUrl("vbscript:msgbox")).toBeNull();
    expect(escapeUrl("data:text/html,<script>")).toBeNull();
  });

  it("allows inline media data URLs, which providers legitimately return", () => {
    expect(escapeUrl("data:image/png;base64,AAA")).not.toBeNull();
    expect(escapeUrl("data:audio/mpeg;base64,AAA")).not.toBeNull();
  });

  it("treats an empty or blank URL as absent", () => {
    expect(escapeUrl("")).toBeNull();
    expect(escapeUrl("   ")).toBeNull();
  });
});

describe("buildComposition — structure", () => {
  it("emits the root attributes HyperFrames keys off", () => {
    const c = buildComposition(input());
    expect(c.html).toContain('data-composition-id="prod-1"');
    expect(c.html).toContain('data-width="1080"');
    expect(c.html).toContain('data-height="1920"');
  });

  it("sizes the frame from the format, not a fixed default", () => {
    expect(buildComposition(input({ format: "16:9" })).width).toBe(1920);
    expect(buildComposition(input({ format: "16:9" })).height).toBe(1080);
    expect(buildComposition(input({ format: "1:1" })).width).toBe(1080);
    expect(buildComposition(input({ format: "1:1" })).height).toBe(1080);
  });

  it("gives every scene a start and a duration", () => {
    const c = buildComposition(input({
      beats: [beat({ idx: 0, seconds: 3 }), beat({ idx: 1, seconds: 5 })],
    }));
    expect(c.html).toContain('data-start="0" data-duration="3"');
    expect(c.html).toContain('data-start="3" data-duration="5"');
  });

  it("starts each voiceover exactly when its picture does", () => {
    const c = buildComposition(input({
      beats: [
        beat({ idx: 0, seconds: 3, audio_url: "https://cdn.test/a0.mp3" }),
        beat({ idx: 1, seconds: 4, audio_url: "https://cdn.test/a1.mp3" }),
      ],
    }));
    // The second beat's audio must carry the same timing as its scene.
    const audioTag = c.html.match(/<audio src="https:\/\/cdn\.test\/a1\.mp3"[^>]*>/)![0];
    expect(audioTag).toContain('data-start="3"');
    expect(audioTag).toContain('data-duration="4"');
  });

  it("reports a total duration equal to the sum of its beats", () => {
    const c = buildComposition(input({
      beats: [beat({ seconds: 2.5 }), beat({ seconds: 4 }), beat({ seconds: 1.5 })],
    }));
    expect(c.total_seconds).toBeCloseTo(8, 3);
    expect(c.html).toContain('data-duration="8"');
  });

  it("uses a real frame rate", () => {
    expect(buildComposition(input()).fps).toBe(DEFAULT_FPS);
  });
});

describe("buildComposition — visuals", () => {
  it("uses an image with a slow push in stills mode", () => {
    const c = buildComposition(input({ visual_mode: "stills" }));
    expect(c.html).toContain("<img class=\"kb\"");
    expect(c.html).toContain("--dur:4s");
    expect(c.html).not.toContain("<video");
  });

  it("uses a muted video element in video mode", () => {
    const c = buildComposition(input({ visual_mode: "video" }));
    expect(c.html).toContain("<video");
    expect(c.html).toContain("muted");
    expect(c.html).not.toContain("<img");
  });

  it("renders a plain ground rather than a broken image when a beat has no visual", () => {
    // Legitimate for avatar and persona productions.
    const c = buildComposition(input({ beats: [beat({ asset_url: null })] }));
    expect(c.html).toContain('class="blank"');
    expect(c.html).not.toContain("src=\"null\"");
    expect(c.html).not.toContain("undefined");
  });

  it("omits the audio element entirely for a silent beat", () => {
    const c = buildComposition(input({ beats: [beat({ audio_url: null })] }));
    expect(c.html).not.toContain("<audio");
  });

  it("omits the caption element when there is no on-screen text", () => {
    const c = buildComposition(input({ beats: [beat({ on_screen_text: "  " })] }));
    expect(c.html).not.toContain('class="caption"');
  });

  it("includes the caption when there is one", () => {
    const c = buildComposition(input({ beats: [beat({ on_screen_text: "180 litres a day" })] }));
    expect(c.html).toContain("180 litres a day");
    expect(c.html).toContain('class="caption"');
  });

  it("scales caption size with the frame so both formats read the same", () => {
    const tall = buildComposition(input({ format: "9:16", beats: [beat({ on_screen_text: "hi" })] }));
    const wide = buildComposition(input({ format: "16:9", beats: [beat({ on_screen_text: "hi" })] }));
    const px = (h: string) => Number(h.match(/font-size:(\d+)px/)![1]);
    expect(px(tall.html)).toBeGreaterThan(px(wide.html));
  });
});

describe("buildComposition — untrusted text", () => {
  it("cannot be broken out of by caption text", () => {
    const c = buildComposition(input({
      beats: [beat({ on_screen_text: '</div><script>fetch("//evil")</script><div>' })],
    }));
    expect(c.html).not.toContain("<script>");
    expect(c.html).toContain("&lt;script&gt;");
  });

  it("escapes the title, which comes from the model too", () => {
    const c = buildComposition(input({ title: 'Kidneys & "filtration" <b>' }));
    expect(c.html).toContain("&amp;");
    expect(c.html).toContain("&quot;");
    expect(c.html).not.toContain("<b>");
  });

  it("drops a scripted asset URL instead of embedding it", () => {
    const c = buildComposition(input({
      beats: [beat({ asset_url: "javascript:alert(1)", audio_url: "javascript:alert(2)" })],
    }));
    expect(c.html).not.toContain("javascript:");
    expect(c.html).toContain('class="blank"');
    expect(c.html).not.toContain("<audio");
  });

  it("keeps an ampersand-bearing signed URL loadable", () => {
    const url = "https://x/a.png?token=t&exp=1";
    const c = buildComposition(input({ beats: [beat({ asset_url: url, audio_url: null })] }));
    expect(c.html).toContain("token=t&amp;exp=1");
  });
});

describe("buildComposition — assets", () => {
  it("declares the URLs it references", () => {
    const c = buildComposition(input({
      beats: [beat({ asset_url: "https://cdn.test/i.png", audio_url: "https://cdn.test/a.mp3" })],
    }));
    expect(c.assets).toContain("https://cdn.test/i.png");
    expect(c.assets).toContain("https://cdn.test/a.mp3");
  });

  it("respects the render proxy's asset cap and says how much it dropped", () => {
    // 15 beats × (image + audio) = 30 URLs, well past the proxy's limit of 20.
    const beats = Array.from({ length: 15 }, (_, i) => beat({
      idx: i, asset_url: `https://cdn.test/i${i}.png`, audio_url: `https://cdn.test/a${i}.mp3`,
    }));
    const c = buildComposition(input({ beats }));
    expect(c.assets).toHaveLength(MAX_DECLARED_ASSETS);
    expect(c.asset_overflow).toBe(10);
    // Truncating the declared list must not truncate the timeline itself.
    expect(c.html).toContain("i14.png");
    expect(c.html).toContain("a14.mp3");
  });

  it("reports no overflow for a normal-length production", () => {
    const beats = Array.from({ length: 5 }, (_, i) => beat({
      idx: i, asset_url: `https://cdn.test/i${i}.png`, audio_url: `https://cdn.test/a${i}.mp3`,
    }));
    expect(buildComposition(input({ beats })).asset_overflow).toBe(0);
  });

  it("does not declare an asset it refused to embed", () => {
    const c = buildComposition(input({
      beats: [beat({ asset_url: "javascript:alert(1)", audio_url: "https://cdn.test/a.mp3" })],
    }));
    expect(c.assets).not.toContain("javascript:alert(1)");
  });
});
