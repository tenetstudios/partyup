import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { createClient } from "npm:@supabase/supabase-js";

import { IngressClient } from "npm:livekit-server-sdk";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  try {
    const { roomName } = await req.json();

    const host = Deno.env.get("LIVEKIT_URL")!;
    const apiKey = Deno.env.get("LIVEKIT_API_KEY")!;
    const apiSecret = Deno.env.get("LIVEKIT_API_SECRET")!;

    const ingressClient = new IngressClient(
      host,
      apiKey,
      apiSecret
    );

    const { data: ingress } = await supabase
      .from("room_ingresses")
      .select("*")
      .eq("room_id", roomName)
      .maybeSingle();

    const ingressId =
  ingress?.ingress_id ||
  "IN_3d95sRR7c7rz";

await ingressClient.deleteIngress(
  ingressId
);

if (!ingress) {
      return new Response(
        JSON.stringify({
          success: true,
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    await ingressClient.deleteIngress(
      ingress.ingress_id
    );

    await supabase
      .from("room_ingresses")
      .delete()
      .eq("room_id", roomName);

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: String(err),
      }),
      {
        status: 500,
      }
    );
  }
});
