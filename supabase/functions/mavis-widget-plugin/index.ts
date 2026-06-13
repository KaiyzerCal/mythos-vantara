import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Widget type label map ─────────────────────────────────────────────────────
const WIDGET_TYPE_LABELS: Record<string, string> = {
  chat: "AI Chat",
  lead_capture: "Lead Capture",
  quote_calculator: "Quote Calculator",
  roi_calculator: "ROI Calculator",
  faq: "FAQ",
  appointment_booker: "Appointment Booking",
};

// ── Sanitize widget ID for use in PHP identifiers ────────────────────────────
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

// ── Build the full WordPress plugin PHP string ───────────────────────────────
function buildPlugin(params: {
  widgetId: string;
  widgetType: string;
  businessName: string;
  publicUrl: string;
  shortcodeName: string;
}): string {
  const { widgetId, widgetType, businessName, publicUrl, shortcodeName } = params;
  const widgetIdSafe = sanitizeId(widgetId);
  const widgetIdUpper = widgetIdSafe.toUpperCase();
  const widgetTypeLabel = WIDGET_TYPE_LABELS[widgetType] ?? widgetType;

  return `<?php
/**
 * Plugin Name: MAVIS AI Widget — ${businessName}
 * Plugin URI: https://mavisvantara.com
 * Description: AI-powered ${widgetTypeLabel} widget for ${businessName}. Powered by MAVIS AI.
 * Version: 1.0.0
 * Author: MAVIS AI
 * Author URI: https://mavisvantara.com
 * License: Proprietary
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'MAVIS_WIDGET_${widgetIdUpper}_URL', '${publicUrl}' );
define( 'MAVIS_WIDGET_${widgetIdUpper}_ID',  '${widgetId}' );

// ── Shortcode: [${shortcodeName}] ────────────────────────────────────────────
function mavis_widget_${widgetIdSafe}_shortcode( $atts ) {
    $atts = shortcode_atts( [ 'class' => '' ], $atts );
    $class = esc_attr( $atts['class'] );
    ob_start(); ?>
    <div id="mavis-widget-container-<?php echo MAVIS_WIDGET_${widgetIdUpper}_ID; ?>" class="mavis-widget-wrap <?php echo $class; ?>"></div>
    <?php return ob_get_clean();
}
add_shortcode( '${shortcodeName}', 'mavis_widget_${widgetIdSafe}_shortcode' );

// ── Enqueue widget script ────────────────────────────────────────────────────
function mavis_widget_${widgetIdSafe}_enqueue() {
    if ( is_singular() || is_page() ) {
        global $post;
        if ( $post && has_shortcode( $post->post_content, '${shortcodeName}' ) ) {
            wp_enqueue_script(
                'mavis-widget-${widgetIdSafe}',
                MAVIS_WIDGET_${widgetIdUpper}_URL,
                [],
                '1.0.0',
                true
            );
        }
    }
    // Also check if chat widget (always load on all pages for floating bubble)
    if ( '${widgetType}' === 'chat' ) {
        wp_enqueue_script(
            'mavis-widget-${widgetIdSafe}',
            MAVIS_WIDGET_${widgetIdUpper}_URL,
            [],
            '1.0.0',
            true
        );
    }
}
add_action( 'wp_enqueue_scripts', 'mavis_widget_${widgetIdSafe}_enqueue' );

// ── Gutenberg block (optional) ───────────────────────────────────────────────
function mavis_widget_${widgetIdSafe}_register_block() {
    if ( ! function_exists( 'register_block_type' ) ) return;
    register_block_type( 'mavis/widget-${widgetIdSafe}', [
        'render_callback' => 'mavis_widget_${widgetIdSafe}_shortcode',
        'attributes'      => [],
    ] );
}
add_action( 'init', 'mavis_widget_${widgetIdSafe}_register_block' );

// ── Admin notice with embed instructions ─────────────────────────────────────
function mavis_widget_${widgetIdSafe}_admin_notice() {
    $screen = get_current_screen();
    if ( ! $screen || $screen->id !== 'plugins' ) return;
    echo '<div class="notice notice-success"><p>';
    echo '<strong>MAVIS AI Widget — ${businessName}</strong> activated! ';
    echo 'Add to any page using shortcode: <code>[${shortcodeName}]</code> ';
    echo '| Chat widgets load automatically on all pages.';
    echo '</p></div>';
}
add_action( 'admin_notices', 'mavis_widget_${widgetIdSafe}_admin_notice' );
`;
}

// ── Build shortcode-only snippet for functions.php ───────────────────────────
function buildShortcodeOnly(params: {
  widgetId: string;
  widgetType: string;
  publicUrl: string;
  shortcodeName: string;
}): string {
  const { widgetId, widgetType, publicUrl, shortcodeName } = params;
  const widgetIdSafe = sanitizeId(widgetId);
  const widgetIdUpper = widgetIdSafe.toUpperCase();

  return `<?php
// MAVIS AI Widget — Shortcode Registration
// Add this to your theme's functions.php

define( 'MAVIS_WIDGET_${widgetIdUpper}_URL', '${publicUrl}' );
define( 'MAVIS_WIDGET_${widgetIdUpper}_ID',  '${widgetId}' );

function mavis_widget_${widgetIdSafe}_shortcode( $atts ) {
    $atts = shortcode_atts( [ 'class' => '' ], $atts );
    $class = esc_attr( $atts['class'] );
    ob_start(); ?>
    <div id="mavis-widget-container-<?php echo MAVIS_WIDGET_${widgetIdUpper}_ID; ?>" class="mavis-widget-wrap <?php echo $class; ?>"></div>
    <?php return ob_get_clean();
}
add_shortcode( '${shortcodeName}', 'mavis_widget_${widgetIdSafe}_shortcode' );

function mavis_widget_${widgetIdSafe}_enqueue() {
    if ( is_singular() || is_page() ) {
        global $post;
        if ( $post && has_shortcode( $post->post_content, '${shortcodeName}' ) ) {
            wp_enqueue_script( 'mavis-widget-${widgetIdSafe}', MAVIS_WIDGET_${widgetIdUpper}_URL, [], '1.0.0', true );
        }
    }
    if ( '${widgetType}' === 'chat' ) {
        wp_enqueue_script( 'mavis-widget-${widgetIdSafe}', MAVIS_WIDGET_${widgetIdUpper}_URL, [], '1.0.0', true );
    }
}
add_action( 'wp_enqueue_scripts', 'mavis_widget_${widgetIdSafe}_enqueue' );
`;
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const {
      widget_id: widgetId,
      widget_type: widgetType,
      business_name: businessName,
      public_url: publicUrl,
      shortcode_name: shortcodeNameRaw,
      action,
    } = body as {
      widget_id: string;
      widget_type: string;
      business_name: string;
      public_url: string;
      shortcode_name?: string;
      action: "generate_plugin" | "generate_shortcode_only";
    };

    // Validate required fields
    if (!widgetId || !widgetType || !businessName || !publicUrl || !action) {
      return new Response(
        JSON.stringify({
          error: "widget_id, widget_type, business_name, public_url, and action are required",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Derive shortcode name: default to mavis_{sanitized_id} if not provided
    const shortcodeName =
      shortcodeNameRaw?.trim() ||
      `mavis_${sanitizeId(widgetId).toLowerCase()}`;

    const widgetIdSafe = sanitizeId(widgetId);

    switch (action) {
      // ── Generate full plugin ────────────────────────────────────────────
      case "generate_plugin": {
        const pluginPhp = buildPlugin({
          widgetId,
          widgetType,
          businessName,
          publicUrl,
          shortcodeName,
        });

        const result = {
          plugin_php: pluginPhp,
          filename: `mavis-widget-${widgetIdSafe}.php`,
          shortcode: `[${shortcodeName}]`,
          installation_steps: [
            "1. Download the plugin file",
            "2. Go to WordPress Admin → Plugins → Add New → Upload Plugin",
            `3. Upload mavis-widget-${widgetIdSafe}.php`,
            "4. Click Activate",
            `5. Add [${shortcodeName}] to any page, or the chat widget appears automatically`,
          ],
        };

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── Generate shortcode only ─────────────────────────────────────────
      case "generate_shortcode_only": {
        const shortcodePhp = buildShortcodeOnly({
          widgetId,
          widgetType,
          publicUrl,
          shortcodeName,
        });

        const result = {
          shortcode_php: shortcodePhp,
          shortcode: `[${shortcodeName}]`,
          instructions: [
            "1. Open your WordPress theme's functions.php file",
            "2. Paste the code snippet at the bottom of the file",
            "3. Save the file",
            `4. Add [${shortcodeName}] to any page or post where you want the widget`,
          ],
        };

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err: any) {
    console.error("[mavis-widget-plugin] error:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
