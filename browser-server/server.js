/**
 * MAVIS Browser Server
 * Playwright-powered: web browsing, data scraping, and PDF generation.
 * Single server handles all three — saves RAM vs running separate containers.
 *
 * Endpoints:
 *   GET  /health          — health check
 *   POST /browse          — navigate to URL, extract text/links/HTML + screenshot
 *   POST /scrape          — extract structured data with CSS selectors
 *   POST /pdf             — render HTML to PDF (Chromium print)
 */

const express  = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 3000;

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", server: "mavis-browser" }));

// ── Browse ────────────────────────────────────────────────────────────────────
app.post("/browse", async (req, res) => {
  const { url, extract = "text", timeout = 30000, wait_for = "domcontentloaded" } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (compatible; MAVIS/1.0)" });
    await page.goto(url, { waitUntil: wait_for, timeout });

    const title      = await page.title();
    const currentUrl = page.url();
    const screenshot = await page.screenshot({ encoding: "base64", type: "png", fullPage: false }).catch(() => null);

    let content;
    switch (extract) {
      case "html":
        content = await page.content();
        break;
      case "links":
        content = await page.$$eval("a[href]", (els) =>
          els.slice(0, 100)
            .map((el) => ({ text: el.innerText.trim(), href: el.href }))
            .filter((l) => l.text && l.href.startsWith("http"))
        );
        break;
      case "structured":
        content = await page.evaluate(() => ({
          title: document.title,
          meta: document.querySelector('meta[name="description"]')?.content ?? "",
          headings: [...document.querySelectorAll("h1,h2,h3")].slice(0, 20).map((h) => h.innerText.trim()),
          paragraphs: [...document.querySelectorAll("p")].slice(0, 30).map((p) => p.innerText.trim()).filter((t) => t.length > 40),
          links: [...document.querySelectorAll("a[href]")].slice(0, 40).map((a) => ({ text: a.innerText.trim(), href: a.href })).filter((l) => l.text),
        }));
        break;
      default: // text
        content = await page.evaluate(() => {
          ["script", "style", "nav", "footer", "header", "aside"].forEach((tag) =>
            document.querySelectorAll(tag).forEach((el) => el.remove())
          );
          return document.body?.innerText?.trim() ?? "";
        });
    }

    res.json({ title, url: currentUrl, content, screenshot });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ── Scrape ────────────────────────────────────────────────────────────────────
app.post("/scrape", async (req, res) => {
  const { url, selectors, timeout = 30000 } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (compatible; MAVIS/1.0)" });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });

    if (selectors && typeof selectors === "object") {
      const results = {};
      for (const [key, selector] of Object.entries(selectors)) {
        try {
          results[key] = await page.$$eval(String(selector), (els) =>
            els.map((el) => ({ text: el.innerText?.trim(), href: el.href ?? null, src: el.src ?? null }))
          );
        } catch {
          results[key] = [];
        }
      }
      res.json(results);
    } else {
      const data = await page.evaluate(() => ({
        title: document.title,
        meta_description: document.querySelector('meta[name="description"]')?.content ?? "",
        og_image: document.querySelector('meta[property="og:image"]')?.content ?? "",
        headings: [...document.querySelectorAll("h1,h2,h3")].slice(0, 20).map((h) => h.innerText.trim()),
        paragraphs: [...document.querySelectorAll("p")].slice(0, 30).map((p) => p.innerText.trim()).filter((t) => t.length > 50),
        links: [...document.querySelectorAll("a[href]")].slice(0, 50).map((a) => ({ text: a.innerText.trim(), href: a.href })).filter((l) => l.text && l.href.startsWith("http")),
        images: [...document.querySelectorAll("img[src]")].slice(0, 20).map((i) => ({ alt: i.alt, src: i.src })),
      }));
      res.json(data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ── PDF ───────────────────────────────────────────────────────────────────────
app.post("/pdf", async (req, res) => {
  const { html, options = {} } = req.body;
  if (!html) return res.status(400).json({ error: "html is required" });

  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });

    const pdf = await page.pdf({
      format:           options.format          ?? "A4",
      printBackground:  options.print_background ?? true,
      landscape:        options.landscape        ?? false,
      margin:           options.margin           ?? { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
      scale:            options.scale            ?? 1,
    });

    res.set("Content-Type", "application/pdf");
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

app.listen(PORT, () => console.log(`MAVIS browser server listening on :${PORT}`));
