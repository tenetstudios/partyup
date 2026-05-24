import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { AccessToken } from "npm:livekit-server-sdk";

serve(async (req) => {
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
            "Content-Type": "application/json",
          },
        }
      );
    }

    const token = new AccessToken(
      apiKey,
      apiSecret,
      {
        identity: participantName,
      }
    );

   token.addGrant({
  roomJoin: true,
  room: roomName,
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,
});

    const jwt = await token.toJwt();
    console.log("JWT:", jwt);

    return new Response(
  JSON.stringify({
    token: jwt,
    canPublish,
    rawCanPublish: body.canPublish,
  }),
  {
    headers: {
      "Content-Type": "application/json",
    },
  }
);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
});