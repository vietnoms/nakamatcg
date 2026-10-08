import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { CardSightAI, getGradingInfo } from "cardsightai";
import { z } from "zod";
import { shortGrade } from "@/import/collectr";
import { medianCents, type CardRead, type Game } from "@/lookup/match";
import type { Confidence, GradedPricer, Provider } from "./identify";

/* ------------------------------------------------------------------ CardSight */

/** CardSight segment names to try per game; the first that works is remembered. */
const SEGMENTS: Record<Game, string[]> = {
  pokemon: ["pokemon", "Pokemon"],
  one_piece: ["one-piece", "onepiece", "One Piece"],
};
const workingSegment = new Map<Game, string>();

function cardsight(): CardSightAI | null {
  const apiKey = process.env.CARDSIGHT_API_KEY;
  return apiKey ? new CardSightAI({ apiKey }) : null;
}

const CONF: Record<string, Confidence> = { High: "high", Medium: "medium", Low: "low" };
const RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export function cardsightProvider(): Provider | null {
  const client = cardsight();
  if (!client) return null;
  return async (img, game) => {
    const tries = workingSegment.has(game) ? [workingSegment.get(game)!] : SEGMENTS[game];
    let lastError = "";
    for (const segment of tries) {
      const res = await client.identify.cardBySegment(segment, img.bytes);
      if (res.error || !res.data?.success) {
        lastError = res.response?.status ? `HTTP ${res.response.status}` : "no response";
        // an unknown segment is a 4xx; anything else (auth, credits, outage) will not get better with another name
        if (res.response?.status === 400 || res.response?.status === 404) continue;
        throw new Error(lastError);
      }
      workingSegment.set(game, segment);
      const best = [...(res.data.detections ?? [])].filter((d) => d.card?.name).sort((a, b) => (RANK[a.confidence] ?? 3) - (RANK[b.confidence] ?? 3))[0];
      if (!best) return null;
      const g = getGradingInfo(best);
      const grade = g?.grade ? shortGrade([g.grade.value, g.grade.condition].filter(Boolean).join(" ")) : "";
      const read: CardRead = {
        game,
        name: best.card.name ?? "",
        setName: [best.card.releaseName, best.card.setName].filter((s) => s && s !== "Base Set").join(" "),
        setCode: "",
        number: best.card.number ?? "",
        finish: "",
        graded: g ? { company: (g.company?.name ?? "").toUpperCase(), grade, cert: "" } : null,
      };
      return { source: "cardsight", confidence: CONF[best.confidence] ?? "low", read, cardsightId: best.card.id };
    }
    throw new Error(`CardSight did not accept the ${game} segment (${lastError})`);
  };
}

/** Median of the last 90 days of sales at this company and grade, from CardSight's sold listings. */
export function cardsightGradedPricer(): GradedPricer | null {
  const client = cardsight();
  if (!client) return null;
  return async (cardId, company, grade) => {
    const res = await client.pricing.get(cardId, { period: "90d" });
    if (res.error || !res.data) throw new Error(res.response?.status ? `HTTP ${res.response.status}` : "no response");
    const num = grade.match(/\d+(\.\d+)?/)?.[0];
    const co = res.data.graded.find((c) => c.company_name.toUpperCase() === company.toUpperCase());
    const gr = co?.grades.find((x) => x.grade_value.match(/\d+(\.\d+)?/)?.[0] === num);
    if (!gr || gr.records.length === 0) return null;
    const median = medianCents(gr.records.map((r) => r.price));
    if (median === null) return null;
    const dates = gr.records.map((r) => r.date ?? "").filter(Boolean).sort();
    return { company: co!.company_name, grade: gr.grade_value, medianCents: median, sales: gr.records.length, lastSale: dates.at(-1) ?? null };
  };
}

/* ------------------------------------------------------------------ Claude */

const ClaudeRead = z.object({
  is_card: z.boolean().describe("false if no trading card is visible"),
  game: z.enum(["pokemon", "one_piece", "other"]),
  name: z.string().describe("card name as printed, e.g. 'Charizard ex' or 'Monkey.D.Luffy'"),
  set_name: z.string().describe("set or expansion name if printed or certain from the symbol, else empty"),
  set_code: z.string().describe("set code printed near the number, e.g. 'OBF', 'SV3', 'OP01', else empty"),
  number: z.string().describe("collector number exactly as printed, e.g. '223/197', 'TG05/TG30', 'OP01-003', 'SWSH284'"),
  finish: z.string().describe("'holo', 'reverse holo', 'normal', '1st edition' or empty if unsure"),
  is_graded: z.boolean().describe("true if the card is sealed in a grading slab"),
  grader: z.string().describe("grading company on the slab label (PSA, CGC, BGS, TAG, SGC), else empty"),
  grade: z.string().describe("grade on the slab label, with Pristine or Black Label if printed, e.g. '10', '9.5', '10 Pristine'"),
  cert: z.string().describe("certification number on the slab label, else empty"),
  confidence: z.enum(["high", "medium", "low"]).describe("how sure you are of name AND number"),
});

const SYSTEM = `You read photos of trading cards taken at a card show: Pokemon TCG or One Piece Card Game, raw or inside a graded slab.
Report what is printed; leave a field empty rather than guess. The collector number is small print near the bottom (Pokemon: bottom left or right like 223/197; One Piece: bottom right like OP01-003). For a slab, also read the label: company, grade and certification number. Use the card's English name when printed in English; for other languages give the printed name.`;

export function claudeProvider(): Provider | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  return async (img, game) => {
    const res = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      // reading print off a photo: little reasoning needed
      output_config: { effort: "low", format: betaZodOutputFormat(ClaudeRead) },
      // a declined request is retried on Anthropic's recommended fallback model instead of failing
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: img.mediaType as "image/jpeg", data: Buffer.from(img.bytes).toString("base64") } },
            { type: "text", text: `The vendor expects a ${game === "one_piece" ? "One Piece" : "Pokemon"} card.` },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal") throw new Error("declined to read this photo");
    const out = res.parsed_output;
    if (!out || !out.is_card || out.game === "other") return null;
    const read: CardRead = {
      game: out.game,
      name: out.name,
      setName: out.set_name,
      setCode: out.set_code,
      number: out.number,
      finish: out.finish,
      graded: out.is_graded ? { company: out.grader.toUpperCase(), grade: shortGrade(out.grade), cert: out.cert } : null,
    };
    return { source: "claude", confidence: out.confidence, read };
  };
}
