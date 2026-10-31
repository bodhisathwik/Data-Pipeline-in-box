import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  question: z.string().min(1).max(500),
  context: z.string().max(12000),
});

export const askData = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) {
      return { ok: false as const, answer: "AI is not configured for this project yet." };
    }
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a concise data analyst assistant embedded in a data-cleaning dashboard. Answer questions about the user's dataset using only the provided context. Keep answers under 120 words. Use short markdown-free plain text and simple lists when helpful.",
          },
          { role: "user", content: `Dataset context:\n${data.context}\n\nQuestion: ${data.question}` },
        ],
      }),
    });
    if (res.status === 429)
      return { ok: false as const, answer: "Rate limit reached — please try again shortly." };
    if (res.status === 402)
      return { ok: false as const, answer: "AI credits exhausted for this workspace." };
    if (!res.ok) return { ok: false as const, answer: "The assistant could not be reached." };
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return {
      ok: true as const,
      answer: json.choices?.[0]?.message?.content ?? "No answer returned.",
    };
  });
