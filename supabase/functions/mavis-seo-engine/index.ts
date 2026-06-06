import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

async function callGemini(prompt: string): Promise<string> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(30000),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}

function extractJson(text: string): unknown {
  // Try to extract JSON from markdown code fences or raw JSON
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1] : text;
  const trimmed = jsonStr.trim();

  // Find the first { or [ and parse from there
  const startIdx = trimmed.search(/[{[]/);
  if (startIdx === -1) throw new Error("No JSON object found in response");
  return JSON.parse(trimmed.slice(startIdx));
}

function buildSchemaForBusinessType(
  business_type: string,
  business_name: string,
  site_url: string,
  location: string,
  description: string,
): Record<string, unknown> {
  const baseUrl = site_url ?? "";
  const name = business_name ?? "";
  const desc = description ?? "";
  const loc = location ?? "";

  const localBusiness = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name,
    description: desc,
    url: baseUrl,
    telephone: "",
    address: {
      "@type": "PostalAddress",
      addressLocality: loc,
    },
  };

  switch (business_type?.toLowerCase()) {
    case "local_business":
    case "local":
      return localBusiness;

    case "ecommerce":
    case "shop":
    case "store":
      return {
        "@context": "https://schema.org",
        "@type": "Store",
        name,
        description: desc,
        url: baseUrl,
        address: {
          "@type": "PostalAddress",
          addressLocality: loc,
        },
        potentialAction: {
          "@type": "SearchAction",
          target: `${baseUrl}/?s={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      };

    case "saas":
    case "software":
    case "app":
      return {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name,
        description: desc,
        url: baseUrl,
        applicationCategory: "BusinessApplication",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
      };

    case "agency":
    case "consulting":
      return {
        "@context": "https://schema.org",
        "@type": "ProfessionalService",
        name,
        description: desc,
        url: baseUrl,
        address: {
          "@type": "PostalAddress",
          addressLocality: loc,
        },
      };

    case "restaurant":
    case "food":
    case "cafe":
      return {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        name,
        description: desc,
        url: baseUrl,
        address: {
          "@type": "PostalAddress",
          addressLocality: loc,
        },
        servesCuisine: "",
        hasMenu: baseUrl,
      };

    case "medical":
    case "healthcare":
    case "clinic":
    case "doctor":
      return {
        "@context": "https://schema.org",
        "@type": "MedicalOrganization",
        name,
        description: desc,
        url: baseUrl,
        address: {
          "@type": "PostalAddress",
          addressLocality: loc,
        },
        telephone: "",
      };

    default:
      return {
        "@context": "https://schema.org",
        "@type": "Organization",
        name,
        description: desc,
        url: baseUrl,
        address: {
          "@type": "PostalAddress",
          addressLocality: loc,
        },
      };
  }
}

async function generateMeta(params: {
  business_name?: string;
  business_type?: string;
  page_title?: string;
  page_content?: string;
  location?: string;
}): Promise<unknown> {
  const { business_name, business_type, page_title, page_content, location } = params;

  const prompt = `You are an expert SEO copywriter. Generate:
1. A meta title (50-60 characters) that is keyword-rich but natural
2. A meta description (150-160 characters) that drives clicks

Business: ${business_name ?? "Unknown"}, Type: ${business_type ?? "general"}${location ? `, Location: ${location}` : ""}
Page title: ${page_title ?? "Home"}
Page content summary: ${page_content?.slice(0, 500) ?? ""}

Return JSON only, no markdown: { "meta_title": "...", "meta_description": "...", "focus_keyword": "...", "secondary_keywords": ["..."] }`;

  const raw = await callGemini(prompt);
  return extractJson(raw);
}

async function generateSchema(params: {
  business_name?: string;
  business_type?: string;
  site_url?: string;
  location?: string;
  description?: string;
}): Promise<string> {
  const schema = buildSchemaForBusinessType(
    params.business_type ?? "organization",
    params.business_name ?? "",
    params.site_url ?? "",
    params.location ?? "",
    params.description ?? "",
  );
  return JSON.stringify(schema, null, 2);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      action,
      page_title,
      page_content,
      business_name,
      business_type,
      location,
      pages,
      site_url,
      description,
    } = body;

    let result: unknown;

    switch (action) {
      case "generate_meta": {
        result = await generateMeta({
          business_name,
          business_type,
          page_title,
          page_content,
          location,
        });
        break;
      }

      case "generate_schema": {
        const schemaJson = await generateSchema({
          business_name,
          business_type,
          site_url,
          location,
          description: description ?? page_content?.slice(0, 200),
        });
        const scriptTag = `<script type="application/ld+json">\n${schemaJson}\n</script>`;
        const wpBlock = `<!-- wp:html -->\n${scriptTag}\n<!-- /wp:html -->`;
        result = {
          schema_json: schemaJson,
          script_tag: scriptTag,
          wp_block: wpBlock,
        };
        break;
      }

      case "optimize_page": {
        const [meta, schemaJson] = await Promise.all([
          generateMeta({ business_name, business_type, page_title, page_content, location }),
          generateSchema({
            business_name,
            business_type,
            site_url,
            location,
            description: description ?? page_content?.slice(0, 200),
          }),
        ]);

        // Keyword density analysis (simple)
        const content = page_content ?? "";
        const words = content.toLowerCase().split(/\s+/).filter(Boolean);
        const wordCount = words.length;
        const wordFreq: Record<string, number> = {};
        for (const w of words) {
          const clean = w.replace(/[^a-z0-9]/g, "");
          if (clean.length > 3) wordFreq[clean] = (wordFreq[clean] ?? 0) + 1;
        }
        const topKeywords = Object.entries(wordFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([word, count]) => ({
            word,
            count,
            density: wordCount > 0 ? `${((count / wordCount) * 100).toFixed(2)}%` : "0%",
          }));

        result = {
          meta,
          schema: {
            json: schemaJson,
            script_tag: `<script type="application/ld+json">\n${schemaJson}\n</script>`,
          },
          keyword_analysis: {
            word_count: wordCount,
            top_keywords: topKeywords,
          },
        };
        break;
      }

      case "audit_site": {
        if (!Array.isArray(pages)) {
          return new Response(
            JSON.stringify({ error: "pages array is required for audit_site" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const missingMeta: unknown[] = [];
        const duplicateTitles: unknown[] = [];
        const missingH1: unknown[] = [];
        const titlesSeen: Record<string, number[]> = {};

        for (const page of pages) {
          const { title, url, type, content, meta_description } = page;

          // Check for missing meta descriptions
          if (!meta_description) {
            missingMeta.push({ title, url });
          }

          // Track duplicate titles
          if (title) {
            if (!titlesSeen[title]) titlesSeen[title] = [];
            titlesSeen[title].push(url);
          }

          // Check for H1 tags
          if (content && !/<h1[\s>]/i.test(content)) {
            missingH1.push({ title, url });
          }
        }

        // Find duplicate titles
        for (const [title, urls] of Object.entries(titlesSeen)) {
          if (urls.length > 1) {
            duplicateTitles.push({ title, urls });
          }
        }

        // Generate internal linking recommendations
        const internalLinks: unknown[] = [];
        for (let i = 0; i < pages.length; i++) {
          for (let j = 0; j < pages.length; j++) {
            if (i === j) continue;
            const pageA = pages[i];
            const pageB = pages[j];
            if (
              pageA.content &&
              pageB.title &&
              pageA.content.toLowerCase().includes(pageB.title.toLowerCase().split(" ")[0])
            ) {
              internalLinks.push({
                from: { title: pageA.title, url: pageA.url },
                to: { title: pageB.title, url: pageB.url },
                reason: `Content on "${pageA.title}" references "${pageB.title}"`,
              });
            }
          }
        }

        result = {
          total_pages: pages.length,
          issues: {
            missing_meta_descriptions: missingMeta,
            duplicate_titles: duplicateTitles,
            missing_h1: missingH1,
          },
          recommendations: {
            internal_linking: internalLinks.slice(0, 10),
          },
          score: Math.max(
            0,
            100 -
              missingMeta.length * 10 -
              duplicateTitles.length * 15 -
              missingH1.length * 5,
          ),
        };
        break;
      }

      case "generate_sitemap": {
        if (!Array.isArray(pages) || pages.length === 0) {
          return new Response(
            JSON.stringify({ error: "pages array is required for generate_sitemap" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const urlEntries = pages.map((page: any) => {
          const priority = page.type === "home"
            ? "1.0"
            : page.type === "service" || page.type === "product"
            ? "0.8"
            : "0.6";
          return `  <url>
    <loc>${page.url}</loc>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
        }).join("\n");

        const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;

        result = { sitemap, page_count: pages.length };
        break;
      }

      case "generate_robots": {
        const baseUrl = site_url ?? "";
        const robotsTxt = `User-agent: *
Allow: /

# Disallow WordPress admin and sensitive paths
Disallow: /wp-admin/
Disallow: /wp-includes/
Disallow: /wp-login.php
Disallow: /xmlrpc.php
Disallow: /?s=
Disallow: /search/
Disallow: /feed/
Disallow: /comments/feed/
Disallow: /trackback/
Disallow: /cgi-bin/

# Allow specific WordPress files
Allow: /wp-admin/admin-ajax.php

# Sitemap
Sitemap: ${baseUrl}/sitemap.xml
`;

        result = { robots_txt: robotsTxt };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("mavis-seo-engine error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
