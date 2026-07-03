import { registerSkill } from "../_registry";

registerSkill(
  {
    name: "logo-gen",
    description:
      "Generate professional brand logos, icons, and visual identity assets. " +
      "Uses Recraft V3 (vector quality, primary) with FLUX 1.1 Pro as fallback. " +
      "Supports lettermarks, wordmarks, icons, combination marks, and emblems " +
      "across styles: minimal, bold, tech, luxury, playful, corporate.",
    keywords: [
      "create a logo",
      "design a logo",
      "make a logo",
      "generate a logo",
      "brand logo",
      "logo design",
      "brand icon",
      "app icon",
      "company logo",
      "lettermark",
      "wordmark",
      "brand identity",
      "logo for",
      "design an icon",
      "create an icon",
      "favicon",
      "emblem",
      "brand mark",
      "visual identity",
      "logo generator",
    ],
  },
  async (input, { supabaseClient, userId }) => {
    const lines = input.trim().split("\n");

    function extract(label: string): string {
      const line = lines.find((l) => l.toLowerCase().startsWith(`${label}:`));
      return line ? line.replace(new RegExp(`^${label}:\\s*`, "i"), "").trim() : "";
    }

    const brandName   = extract("brand") || extract("brand_name") || extract("name");
    const description = extract("description") || extract("desc");
    const style       = extract("style");
    const colors      = extract("colors") || extract("color");
    const logoType    = extract("type") || extract("logo_type");
    const format      = extract("format");

    if (!brandName) {
      return (
        "Please provide a brand name. Example:\n\n" +
        "```\n" +
        "Brand: Apex AI\n" +
        "Description: AI-powered productivity tools\n" +
        "Style: minimal\n" +
        "Colors: deep blue and white\n" +
        "Type: icon\n" +
        "```"
      );
    }

    const { data, error } = await supabaseClient.functions.invoke("mavis-logo-gen", {
      body: {
        brand_name:  brandName,
        description: description || brandName,
        style:       style       || "default",
        colors:      colors      || "",
        logo_type:   logoType    || "icon",
        format:      format      || "square",
      },
    });

    if (error) return `Logo generation failed: ${error.message}`;
    if (data?.error) return `Logo generation error: ${data.error}`;
    if (!data?.url) return `Unexpected response from logo generator: ${JSON.stringify(data)}`;

    const typeLabel = data.logo_type ?? logoType ?? "icon";
    const styleLabel = data.style ?? style ?? "default";

    return (
      `**${brandName}** logo generated (${typeLabel}, ${styleLabel} style) via ${data.provider}.\n\n` +
      `**Logo URL:** ${data.url}\n\n` +
      `_Prompt used: ${data.prompt_used}_`
    );
  },
);
