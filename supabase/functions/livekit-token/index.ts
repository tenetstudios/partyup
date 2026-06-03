import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { AccessToken } from "npm:livekit-server-sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json();

    const roomName = body.roomName;
    const participantName = body.participantName;
    const requestedCanPublish = body.canPublish;

    const canPublish =
      requestedCanPublish === true ||
      requestedCanPublish === "true" ||
      requestedCanPublish === "yes" ||
      requestedCanPublish === 1 ||
      requestedCanPublish === "1";

    console.log("LIVEKIT TOKEN DEBUG:", {
      roomName,
      participantName,
      requestedCanPublish,
      resolvedCanPublish: canPublish,
    });

    const apiKey = Deno.env.get("LIVEKIT_API_KEY");
    const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");

    if (!apiKey || !apiSecret) {
      return new Response(
        JSON.stringify({
          error: "Missing LiveKit credentials",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (!roomName || !participantName) {
      return new Response(
        JSON.stringify({
          error: "Missing roomName or participantName",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantName,
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    return new Response(
      JSON.stringify({
        token: jwt,
        canPublish,
        rawCanPublish: body.canPublish,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});