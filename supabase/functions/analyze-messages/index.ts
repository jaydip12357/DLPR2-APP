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

interface FlagResult {
  id: number;
  is_flagged: boolean;
  flag_reason: string | null;
  severity: string | null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role key to bypass RLS
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    // Build the prompt for OpenAI
    const messagesForAI = messages.map((m: Message) => ({
      id: m.id,
      text: m.text,
      sender: m.sender || "unknown",
      app: m.app_source,
      direction: m.direction,
    }));

    const systemPrompt = `You are a child safety content analyzer for a parental monitoring app called SafeType.
Your job is to analyze messages captured from a child's device and flag any that contain concerning content.

Flag messages that contain:
- Bullying, harassment, or hate speech
- Sexual or sexually suggestive content
- Violence or threats of violence
- Self-harm or suicidal ideation
- Drug or alcohol references
- Profanity or extremely vulgar language
- Contact with strangers / grooming patterns
- Sharing personal information (address, phone, etc.)

For each message, respond with:
- "flagged": true/false
- "reason": brief explanation if flagged (null if not flagged)
- "severity": "high", "medium", or "low" if flagged (null if not flagged)

Be sensitive but avoid false positives on normal teen conversation. Mild slang is OK.
Focus on genuinely concerning content.

Respond ONLY with a JSON array matching the input message IDs. Example:
[{"id": 1, "flagged": true, "reason": "profanity and bullying language", "severity": "high"}, {"id": 2, "flagged": false, "reason": null, "severity": null}]`;

    const userPrompt = `Analyze these messages:\n${JSON.stringify(messagesForAI, null, 2)}`;

    // Call OpenAI
    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 2000,
        }),
      }
    );

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      throw new Error(`OpenAI API error (${openaiResponse.status}): ${errText}`);
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content || "[]";

    // Parse the AI response
    let results: Array<{
      id: number;
      flagged: boolean;
      reason: string | null;
      severity: string | null;
    }>;

    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      results = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      console.error("Failed to parse OpenAI response:", content);
      results = [];
    }

    // Update Supabase with results
    let flaggedCount = 0;
    for (const result of results) {
      const updateData: Record<string, unknown> = {
        is_flagged: result.flagged,
        flag_reason: result.flagged ? result.reason : null,
      };

      const { error: updateError } = await supabase
        .from("messages")
        .update(updateData)
        .eq("id", result.id);

      if (updateError) {
        console.error(`Failed to update message ${result.id}:`, updateError);
      }

      if (result.flagged) flaggedCount++;
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        analyzed: results.length,
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
