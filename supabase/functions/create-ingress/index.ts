import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { createClient } from "npm:@supabase/supabase-js";

import {
  IngressClient,
  IngressInput,
} from "npm:livekit-server-sdk";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  try {
    const {
  roomName,
  userId,
  participantName,
} = await req.json();

    if (!roomName) {
      return new Response(
        JSON.stringify({ error: "Missing roomName" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const host = Deno.env.get("LIVEKIT_URL")!;
    const apiKey = Deno.env.get("LIVEKIT_API_KEY")!;
    const apiSecret = Deno.env.get("LIVEKIT_API_SECRET")!;

    const ingressClient = new IngressClient(host, apiKey, apiSecret);

    const { data: existing } = await supabase
      .from("room_ingresses")
      .select("*")
      .eq("room_id", roomName)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({
          url: existing.url,
          streamKey: existing.stream_key,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const cleanName =
      typeof participantName === "string" && participantName.trim()
        ? participantName.trim()
        : "OBS Streamer";

    const ingress = await ingressClient.createIngress(
      IngressInput.RTMP_INPUT,
      {
        name: `PartyUp OBS - ${cleanName}`,
        roomName,
        participantIdentity: `obs-${userId}-${roomName}`,
        participantName: cleanName,
      }
    );

    await supabase.from("room_ingresses").insert({
      room_id: roomName,
      ingress_id: ingress.ingressId,
      url: ingress.url,
      stream_key: ingress.streamKey,
    });

    return new Response(
      JSON.stringify({
        url: ingress.url,
        streamKey: ingress.streamKey,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: String(err),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});