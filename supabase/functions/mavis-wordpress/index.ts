import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function wpBase64Auth(username: string, appPassword: string): string {
  const creds = `${username}:${appPassword.replace(/\s/g, "")}`;
  return btoa(creds);
}

function normalizeSiteUrl(siteUrl: string): string {
  if (!siteUrl.startsWith("http://") && !siteUrl.startsWith("https://")) {
    return `https://${siteUrl}`;
  }
  return siteUrl;
}

// ── Unified API fetch — supports both app-password and WP.com OAuth ──
// For app-password: base = {siteUrl}/wp-json, auth = Basic {header}
// For WP.com OAuth: base = https://public-api.wordpress.com,
//   path /wp/v2/foo becomes /wp/v2/sites/{blogId}/foo, auth = Bearer {token}
type AuthMode =
  | { type: "basic"; header: string; siteUrl: string }
  | { type: "wpcom"; token: string; blogId: number | string };

async function apiFetch(
  auth: AuthMode,
  path: string,
  method: string,
  body?: unknown,
  isFormData = false,
): Promise<any> {
  let url: string;
  let authValue: string;

  if (auth.type === "wpcom") {
    // Inject /sites/{blogId} after /wp/v2 in the path
    const wpcomPath = path.replace(/^\/wp\/v2/, `/wp/v2/sites/${auth.blogId}`);
    url = `https://public-api.wordpress.com${wpcomPath}`;
    authValue = `Bearer ${auth.token}`;
  } else {
    url = `${auth.siteUrl.replace(/\/$/, "")}/wp-json${path}`;
    authValue = `Basic ${auth.header}`;
  }

  const headers: Record<string, string> = { Authorization: authValue };
  if (!isFormData) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: isFormData ? body as FormData : (body ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WP ${method} ${path} → ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      action,
      site_url: rawSiteUrl,
      username,
      app_password,
      access_token,    // WP.com OAuth
      wpcom_blog_id,   // WP.com OAuth
      ...rest
    } = body;

    // ── Resolve auth mode ─────────────────────────────────────────────
    let auth: AuthMode;
    let site_url = rawSiteUrl ? normalizeSiteUrl(rawSiteUrl) : "";

    if (access_token && wpcom_blog_id) {
      auth = { type: "wpcom", token: access_token, blogId: Number(wpcom_blog_id) };
    } else {
      if (!rawSiteUrl || !username || !app_password) {
        return new Response(
          JSON.stringify({ error: "Provide either (site_url + username + app_password) or (access_token + wpcom_blog_id)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      auth = { type: "basic", header: wpBase64Auth(username, app_password), siteUrl: site_url };
    }

    // Convenience wrapper — callers pass just (path, method, body?, isFormData?)
    const api = (path: string, method: string, body?: unknown, isFormData = false) =>
      apiFetch(auth, path, method, body, isFormData);

    let result: unknown;

    switch (action) {
      case "test_connection": {
        const me = await api("/wp/v2/users/me", "GET");
        const settings = await api("/wp/v2/settings", "GET").catch(() => null);
        result = {
          connected: true,
          site_title: settings?.title ?? null,
          username: me.name,
          capabilities: me.capabilities ?? {},
        };
        break;
      }

      case "get_site_info": {
        const settings = await api("/wp/v2/settings", "GET");
        result = {
          title: settings.title,
          tagline: settings.description,
          url: settings.url,
          timezone: settings.timezone,
        };
        break;
      }

      case "set_site_identity": {
        const { title, description, logo_base64, logo_filename } = rest;
        const updated = await api("/wp/v2/settings", "POST", {
          title,
          description,
        });

        let logoMedia = null;
        if (logo_base64) {
          const filename = logo_filename ?? "logo.png";
          const mimeType = filename.endsWith(".png") ? "image/png" : "image/jpeg";
          const binaryStr = atob(logo_base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: mimeType });
          const form = new FormData();
          form.append("file", blob, filename);
          logoMedia = await api("/wp/v2/media", "POST", form, true);
        }

        result = {
          title: updated.title,
          description: updated.description,
          logo: logoMedia ? { id: logoMedia.id, source_url: logoMedia.source_url } : null,
        };
        break;
      }

      case "get_pages": {
        const pages = await api("/wp/v2/pages?per_page=100&status=any", "GET");
        result = pages.map((p: any) => ({
          id: p.id,
          title: p.title?.rendered ?? p.title,
          slug: p.slug,
          status: p.status,
          link: p.link,
        }));
        break;
      }

      case "get_posts": {
        const posts = await api("/wp/v2/posts?per_page=20&status=any", "GET");
        result = posts.map((p: any) => ({
          id: p.id,
          title: p.title?.rendered ?? p.title,
          slug: p.slug,
          status: p.status,
          link: p.link,
          date: p.date,
        }));
        break;
      }

      case "create_page": {
        const { title, content, status, slug, template, meta } = rest;
        const pageBody: Record<string, unknown> = { title, content, status: status ?? "draft" };
        if (slug) pageBody.slug = slug;
        if (template) pageBody.template = template;
        if (meta) pageBody.meta = meta;

        const page = await api("/wp/v2/pages", "POST", pageBody);
        result = {
          id: page.id,
          link: page.link,
          slug: page.slug,
          status: page.status,
        };
        break;
      }

      case "update_page": {
        const { id, title, content, status, slug, template, meta } = rest;
        if (!id) throw new Error("id is required for update_page");

        const pageBody: Record<string, unknown> = {};
        if (title !== undefined) pageBody.title = title;
        if (content !== undefined) pageBody.content = content;
        if (status !== undefined) pageBody.status = status;
        if (slug !== undefined) pageBody.slug = slug;
        if (template !== undefined) pageBody.template = template;
        if (meta !== undefined) pageBody.meta = meta;

        const page = await api(`/wp/v2/pages/${id}`, "PUT", pageBody);
        result = {
          id: page.id,
          link: page.link,
          slug: page.slug,
          status: page.status,
        };
        break;
      }

      case "create_post": {
        const { title, content, status, categories, tags, meta } = rest;
        const postBody: Record<string, unknown> = {
          title,
          content,
          status: status ?? "draft",
        };
        if (categories) postBody.categories = categories;
        if (tags) postBody.tags = tags;
        if (meta) postBody.meta = meta;

        const post = await api("/wp/v2/posts", "POST", postBody);
        result = { id: post.id, link: post.link };
        break;
      }

      case "upload_media": {
        const { image_url, image_base64, filename: rawFilename, alt_text } = rest;
        const filename = rawFilename ?? "image.jpg";
        const mimeType = filename.endsWith(".png") ? "image/png" : "image/jpeg";

        let blob: Blob;
        if (image_url) {
          const imageRes = await fetch(image_url);
          blob = await imageRes.blob();
        } else if (image_base64) {
          const binaryStr = atob(image_base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          blob = new Blob([bytes], { type: mimeType });
        } else {
          throw new Error("Either image_url or image_base64 is required for upload_media");
        }

        const form = new FormData();
        form.append("file", blob, filename);
        if (alt_text) form.append("alt_text", alt_text);

        const media = await api("/wp/v2/media", "POST", form, true);
        result = {
          id: media.id,
          source_url: media.source_url,
          alt_text: media.alt_text ?? alt_text ?? "",
        };
        break;
      }

      case "set_featured_image": {
        const { page_id, post_id, media_id } = rest;
        const resourceId = page_id ?? post_id;
        const resourceType = page_id ? "pages" : "posts";
        if (!resourceId) throw new Error("page_id or post_id is required for set_featured_image");
        if (!media_id) throw new Error("media_id is required for set_featured_image");

        const updated = await api(
          `/wp/v2/${resourceType}/${resourceId}`,
          "PUT",
          { featured_media: media_id },
        );
        result = { id: updated.id, featured_media: updated.featured_media };
        break;
      }

      case "set_homepage": {
        const { home_page_id } = rest;
        let homePageId = home_page_id;

        if (!homePageId) {
          // Try to find an existing "Home" page
          const pages = await api('/wp/v2/pages?per_page=100&status=any&search=Home', "GET");
          const homePage = pages.find(
            (p: any) => (p.title?.rendered ?? p.title)?.toLowerCase() === "home",
          );

          if (homePage) {
            homePageId = homePage.id;
          } else {
            // Create a Home page
            const newPage = await api("/wp/v2/pages", "POST", {
              title: "Home",
              status: "publish",
              slug: "home",
            });
            homePageId = newPage.id;
          }
        }

        await api("/wp/v2/settings", "POST", {
          show_on_front: "page",
          page_on_front: homePageId,
        });

        result = { home_page_id: homePageId, show_on_front: "page" };
        break;
      }

      case "create_menu": {
        const { name, items } = rest;
        const menuName = name ?? "Main Menu";

        const menu = await api("/wp/v2/menus", "POST", { name: menuName });
        const menuId = menu.id;

        const createdItems: unknown[] = [];
        if (Array.isArray(items)) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const menuItem = await api("/wp/v2/menu-items", "POST", {
              title: item.title,
              url: item.url,
              menus: menuId,
              menu_order: item.menu_order ?? i + 1,
              status: "publish",
            });
            createdItems.push({ id: menuItem.id, title: menuItem.title, url: menuItem.url });
          }
        }

        result = { menu_id: menuId, items_created: createdItems.length, items: createdItems };
        break;
      }

      case "get_categories": {
        const cats = await api("/wp/v2/categories", "GET");
        result = cats.map((c: any) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          count: c.count,
        }));
        break;
      }

      case "create_category": {
        const { name, slug, description } = rest;
        const catBody: Record<string, unknown> = { name };
        if (slug) catBody.slug = slug;
        if (description) catBody.description = description;

        const cat = await api("/wp/v2/categories", "POST", catBody);
        result = { id: cat.id, name: cat.name, slug: cat.slug };
        break;
      }

      case "get_plugins": {
        const plugins = await api("/wp/v2/plugins", "GET");
        result = plugins.map((p: any) => ({
          plugin: p.plugin,
          name: p.name,
          status: p.status,
          version: p.version,
          author: p.author,
        }));
        break;
      }

      case "install_theme": {
        result = {
          message: "Theme installation via REST API requires direct server access.",
          instructions: [
            "1. Log in to your WordPress admin dashboard at ${site_url}/wp-admin",
            "2. Go to Appearance → Themes → Add New",
            "3. Search for your desired theme or upload a theme ZIP file",
            "4. Click Install, then Activate",
          ],
          note: "Alternatively, use WP-CLI: wp theme install <theme-slug> --activate",
        };
        break;
      }

      case "create_woocommerce_product": {
        const {
          name,
          type,
          regular_price,
          description: desc,
          short_description,
          categories: cats,
          images,
          status: prodStatus,
        } = rest;

        try {
          const product = await api("/wc/v3/products", "POST", {
            name,
            type: type ?? "simple",
            regular_price,
            description: desc,
            short_description,
            categories: cats ?? [],
            images: images ?? [],
            status: prodStatus ?? "publish",
          });
          result = { id: product.id, name: product.name, permalink: product.permalink };
        } catch (err: any) {
          if (err.message?.includes("404")) {
            result = { error: "WooCommerce not installed", configured: false };
          } else {
            throw err;
          }
        }
        break;
      }

      case "get_woocommerce_products": {
        try {
          const products = await api("/wc/v3/products?per_page=20", "GET");
          result = products.map((p: any) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            price: p.price,
            permalink: p.permalink,
          }));
        } catch (err: any) {
          if (err.message?.includes("404")) {
            result = { error: "WooCommerce not installed", configured: false };
          } else {
            throw err;
          }
        }
        break;
      }

      case "bulk_create_pages": {
        const { pages } = rest;
        if (!Array.isArray(pages)) throw new Error("pages array is required for bulk_create_pages");

        const created: unknown[] = [];
        for (const p of pages) {
          const pageBody: Record<string, unknown> = {
            title: p.title,
            content: p.content ?? "",
            status: p.status ?? "draft",
          };
          if (p.slug) pageBody.slug = p.slug;
          if (p.meta) pageBody.meta = p.meta;

          const page = await api("/wp/v2/pages", "POST", pageBody);
          created.push({ id: page.id, link: page.link, slug: page.slug });
        }

        result = created;
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
    console.error("mavis-wordpress error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
