import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  IngressClient,
  IngressInput,
} from "npm:livekit-server-sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const roomName = body.roomName;
    const participantName = body.participantName || "OBS Stream";

    if (!roomName) {
      return new Response(JSON.stringify({ error: "Missing roomName" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const livekitUrl = Deno.env.get("LIVEKIT_URL");
    const apiKey = Deno.env.get("LIVEKIT_API_KEY");
    const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");

    if (!livekitUrl || !apiKey || !apiSecret) {
      return new Response(
        JSON.stringify({ error: "Missing LiveKit environment variables" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const ingressClient = new IngressClient(livekitUrl, apiKey, apiSecret);

    const ingress = await ingressClient.createIngress(
      IngressInput.RTMP_INPUT,
      {
        name: `PartyUp OBS - ${roomName}`,
        roomName,
        participantName,
        participantIdentity: `obs-${roomName}`,
      },
    );

    return new Response(
      JSON.stringify({
        ingressId: ingress.ingressId,
        rtmpUrl: ingress.url,
        streamKey: ingress.streamKey,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});