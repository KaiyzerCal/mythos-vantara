import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { url, project_id, user_id } = await req.json();
    if (!url || !project_id || !user_id) {
      return new Response(JSON.stringify({ error: 'url, project_id, user_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SB_URL, SB_KEY);

    // Detect URL type
    let downloadUrl: string | null = null;
    let videoTitle = "Imported Video";

    const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);

    if (youtubeMatch) {
      // Use Invidious API to get direct video URL
      const videoId = youtubeMatch[1];
      const invidiousInstances = [
        'https://invidious.io',
        'https://inv.nadeko.net',
        'https://invidious.nerdvpn.de',
      ];

      for (const instance of invidiousInstances) {
        try {
          const infoRes = await fetch(`${instance}/api/v1/videos/${videoId}`,
            { signal: AbortSignal.timeout(10000) });
          if (!infoRes.ok) continue;
          const info = await infoRes.json();
          videoTitle = info.title || videoTitle;

          // Get best quality format streams
          const formatStreams = info.formatStreams || [];

          // Prefer mp4 at 720p or best available
          const mp4Stream = formatStreams.find((f: any) =>
            f.container === 'mp4' && (f.qualityLabel === '720p' || f.qualityLabel === '480p' || f.qualityLabel === '360p')
          ) || formatStreams.find((f: any) => f.container === 'mp4');

          if (mp4Stream?.url) {
            downloadUrl = mp4Stream.url.startsWith('/')
              ? `${instance}${mp4Stream.url}`
              : mp4Stream.url;
            break;
          }
        } catch { continue; }
      }

      if (!downloadUrl) {
        return new Response(JSON.stringify({
          error: 'Could not extract YouTube video. The video may be age-restricted, private, or unavailable.',
          suggestion: 'Try downloading the video manually and uploading it directly.'
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else if (url.match(/^https?:\/\/.+\.(mp4|mov|webm|avi)(\?.*)?$/i)) {
      // Direct video URL
      downloadUrl = url;
      videoTitle = url.split('/').pop()?.split('?')[0]?.replace(/\.[^.]+$/, '') || "Imported Video";
    } else {
      return new Response(JSON.stringify({
        error: 'Unsupported URL. Supported: YouTube, direct MP4/MOV/WebM/AVI links.'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Stream-download and upload to Supabase storage
    const videoRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(120000) });
    if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`);

    const contentType = videoRes.headers.get('content-type') || 'video/mp4';
    const ext = contentType.includes('webm') ? 'webm' : contentType.includes('mov') ? 'mov' : 'mp4';
    const storagePath = `${user_id}/${project_id}/${Date.now()}-import.${ext}`;

    const videoBuffer = await videoRes.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from('video-projects')
      .upload(storagePath, videoBuffer, { contentType, upsert: false });

    if (uploadError) throw uploadError;

    // Get video file size
    const clipSize = videoBuffer.byteLength;

    // Create video_clip record
    const { data: clip, error: clipError } = await supabase
      .from('video_clips')
      .insert({
        project_id,
        user_id,
        title: videoTitle,
        storage_path: storagePath,
        file_size: clipSize,
        status: 'ready',
        source_url: url,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (clipError) throw clipError;

    // Generate signed URL for immediate playback
    const { data: signedData } = await supabase.storage
      .from('video-projects')
      .createSignedUrl(storagePath, 3600);

    return new Response(JSON.stringify({
      success: true,
      clip: { ...clip, signed_url: signedData?.signedUrl }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Download failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
