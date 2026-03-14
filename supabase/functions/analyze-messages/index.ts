import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Message {
  id: number;
  text: string;
  sender: string | null;
  app_source: string;
  direction: string;
  source_layer: string;
}

const CUSTOM_MODEL_URL = "https://dl-project-2-second-version.onrender.com";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Use service role key to bypass RLS
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Read custom model URL from settings table (fallback to default)
    let modelUrl = CUSTOM_MODEL_URL;
    try {
      const { data: setting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "custom_model_url")
        .single();
      if (setting?.value) {
        modelUrl = setting.value;
      }
    } catch {
      // No setting found — use default
    }
    const apiUrl = modelUrl.replace(/\/$/, "") + "/api/predict";

    // Parse optional request body for specific message IDs
    let messageIds: number[] | null = null;
    try {
      const body = await req.json();
      if (body.message_ids && Array.isArray(body.message_ids)) {
        messageIds = body.message_ids;
      }
    } catch {
      // No body or invalid JSON — analyze all unanalyzed messages
    }

    // Fetch unanalyzed messages
    let query = supabase
      .from("messages")
      .select("id, text, sender, app_source, direction, source_layer")
      .is("is_flagged", null)
      .order("timestamp", { ascending: false })
      .limit(25);

    if (messageIds) {
      query = supabase
        .from("messages")
        .select("id, text, sender, app_source, direction, source_layer")
        .in("id", messageIds)
        .limit(25);
    }

    const { data: messages, error: fetchError } = await query;
    if (fetchError) {
      throw new Error(`Fetch error: ${fetchError.message}`);
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ status: "ok", analyzed: 0, flagged: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call custom Render model for each message
    let flaggedCount = 0;
    let analyzedCount = 0;

    for (const msg of messages as Message[]) {
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: msg.text }),
        });

        if (!response.ok) {
          console.error(`Model API error for msg ${msg.id}: ${response.status}`);
          continue;
        }

        const data = await response.json();

        // Map custom model response to our flag format
        const isFlagged = data.label !== "clean";
        const reason = isFlagged
          ? `${data.label} (${Math.round(data.confidence * 100)}% confidence)`
          : null;

        const { error: updateError } = await supabase
          .from("messages")
          .update({
            is_flagged: isFlagged,
            flag_reason: reason,
          })
          .eq("id", msg.id);

        if (updateError) {
          console.error(`Failed to update message ${msg.id}:`, updateError);
        }

        analyzedCount++;
        if (isFlagged) flaggedCount++;
      } catch (e) {
        console.error(`Error analyzing message ${msg.id}:`, e);
      }
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        analyzed: analyzedCount,
        flagged: flaggedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Analysis error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
