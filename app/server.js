const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3210);
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

function isSafePath(requestPath) {
  return path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
}

function decodeEntities(input) {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(input) {
  return decodeEntities(input.replace(/<[^>]+>/g, " "));
}

function normalizeWhitespace(input) {
  return input
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueLines(lines) {
  const seen = new Set();
  const result = [];
  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line || seen.has(line)) {
      continue;
    }
    seen.add(line);
    result.push(line);
  }
  return result;
}

function isShortLabelLine(line) {
  return line.length <= 24 && /^[A-Z0-9 %&()+/-]+$/i.test(line) && /[a-zA-Z]/.test(line);
}

function isShortValueLine(line) {
  return line.length <= 18 && /[0-9%$€£]/.test(line);
}

function combineFactPairs(lines) {
  const result = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];

    if (
      current &&
      next &&
      isShortLabelLine(current) &&
      isShortValueLine(next) &&
      !/:/.test(current)
    ) {
      result.push(`${current}: ${next}`);
      index += 1;
      continue;
    }

    result.push(current);
  }
  return uniqueLines(result);
}

function cleanSourceLines(text) {
  const noisePatterns = [
    /^solutions$/i,
    /^about us$/i,
    /^contact(s)?$/i,
    /^pricing$/i,
    /^thank you!?$/i,
    /^something went wrong/i,
    /^terms of service$/i,
    /^privacy policy$/i,
    /^cookies$/i,
    /^all rights reserved/i,
    /^agencies solutions$/i,
    /^developer solutions$/i,
    /^cee news$/i,
    /^cee blog$/i,
  ];

  return combineFactPairs(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line.length > 2)
      .filter((line) => !noisePatterns.some((pattern) => pattern.test(line)))
      .filter((line) => !/^[finxyt|©]+$/i.test(line)),
  );
}

function sentenceCase(text) {
  return text.replace(/\s+/g, " ").trim();
}

function isPricingLine(line) {
  return (
    /\$\s*\d|€\s*\d|£\s*\d|\d+\s?(usd|eur|gbp)/i.test(line) ||
    /pricing|price|monthly fee|implementation fee|setup fee|annual fee|per user|per month|per year|starting at|from\s+\$|quote/i.test(
      line,
    )
  );
}

function isBoilerplateLine(line) {
  return /available languages|payment gateways|all rights reserved|terms of service|privacy policy|cookies/i.test(line);
}

function pickFirstMeaningfulDescription(lines, title) {
  const titleLower = (title || "").toLowerCase();
  return (
    lines.find((line) => {
      const lower = line.toLowerCase();
      return (
        lower !== titleLower &&
        line.length >= 28 &&
        !isPricingLine(line) &&
        !isBoilerplateLine(line)
      );
    }) || ""
  );
}

function extractAudienceLines(lines) {
  return lines
    .filter((line) => /for\s+[a-z0-9][^.!?]{3,}|designed for|ideal for|built for|help(s)?\s+[a-z]/i.test(line))
    .filter((line) => !isPricingLine(line) && !isBoilerplateLine(line))
    .slice(0, 2);
}

function extractFeatureLines(lines) {
  const featureKeywords =
    /platform|software|solution|tool|app|system|dashboard|automation|manage|track|integrate|analytics|reporting|workflow|payment|booking|search|support|alerts?|notifications?|sync|import|export|ai|data|team|customer|client|sales|marketing/i;

  return lines
    .filter(
      (line) =>
        featureKeywords.test(line) &&
        !isPricingLine(line) &&
        !isBoilerplateLine(line),
    )
    .filter((line) => line.length >= 22)
    .slice(0, 5);
}

function extractFactLines(lines) {
  return lines
    .filter((line) => /:/.test(line) || /\b(calories|ingredients|contains|volume|abv|ibu|price|from|starts at)\b/i.test(line))
    .filter((line) => !isBoilerplateLine(line))
    .slice(0, 4);
}

function extractPackageLines(lines) {
  const packagePatterns = [
    /(standard|enhanced|enterprise|premium|basic|starter|professional|pro|business|team|growth|scale)\s*[:|-]/i,
    /(implementation fee|monthly fee|setup fee|annual fee|license fee|per user|per seat|minimum spend|usage-based|monthly pricing|yearly pricing)/i,
    /\$\s*\d/,
    /€\s*\d/,
    /£\s*\d/,
    /includes up to/i,
    /custom pricing applies/i,
    /contact sales/i,
    /quote/i,
  ];

  return lines
    .filter((line) => packagePatterns.some((pattern) => pattern.test(line)))
    .slice(0, 6);
}

function formatBulletBlock(lines, emptyMessage) {
  if (!lines.length) {
    return emptyMessage;
  }
  return lines.map((line) => `- ${sentenceCase(line)}`).join("\n");
}

function buildHeuristicContent({ title, extractedText }) {
  const lines = cleanSourceLines(extractedText);
  const description = pickFirstMeaningfulDescription(lines, title);
  const audience = extractAudienceLines(lines);
  const features = extractFeatureLines(lines);
  const facts = extractFactLines(lines);
  const pricing = extractPackageLines(lines);

  return {
    description,
    audience,
    features,
    facts,
    pricing,
    hasPackages: pricing.some((line) =>
      /(standard|enhanced|enterprise|premium|basic|starter|professional|pro|business|team|growth|scale)/i.test(
        line,
      ),
    ),
  };
}

function extractHtmlParts(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescriptionMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );

  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n");

  const chunkMatches = [...withoutNoise.matchAll(/<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi)];
  const chunks = uniqueLines(chunkMatches.map((match) => stripTags(match[2])));
  const headings = uniqueLines(
    [...withoutNoise.matchAll(/<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => stripTags(match[2])),
  );

  return {
    title: titleMatch ? normalizeWhitespace(stripTags(titleMatch[1])) : "",
    description: metaDescriptionMatch ? normalizeWhitespace(decodeEntities(metaDescriptionMatch[1])) : "",
    chunks,
    headings,
  };
}

function trimForModel(text, maxChars = 18000) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n[Content truncated for processing]`;
}

function buildFallbackSummary({ url, title, extractedText, languageMode, outputPurpose }) {
  const { description, audience, features, facts, pricing, hasPackages } = buildHeuristicContent({
    title,
    extractedText,
  });
  const combinedFeatures = [...audience, ...features, ...facts].slice(0, 5);

  const result = {
    mode: "fallback",
    sourceUrl: url,
    extractedTitle: title,
    languageMode,
    outputPurpose,
  };

  if (languageMode === "en") {
    result.english = {
      subject: outputPurpose === "summary" ? title || "Short summary" : title || "Product overview",
      opening:
        outputPurpose === "summary"
          ? `${title || "This product"} in short: ${description || "the source presents a product with a clear business use case and practical feature set."}`
          : `I wanted to share a short overview of ${title || "this product"}. ${description || "It appears to offer a practical solution with a clear business focus."} From the source, it looks relevant where a client needs a concise explanation of what the product does and why it matters.`,
      keyPoints: formatBulletBlock(
        combinedFeatures,
        "- The source did not expose enough clear feature detail for a stronger automatic summary.",
      ),
      plans: pricing.length
        ? [
            hasPackages ? "From the pricing section, these are the main package and fee points:" : "From the pricing section, these are the main points:",
            formatBulletBlock(pricing, ""),
          ].join("\n")
        : "- The source does not show a clearly structured package or pricing breakdown.",
      closing:
        outputPurpose === "summary"
          ? `For more details, see the source here: ${url}`
          : `If this looks relevant, I can share more detail, but the full source page is here: ${url}`,
      sourceNote: outputPurpose === "summary" ? `Source: ${url}` : `Read more: ${url}`,
    };
  }

  if (languageMode === "cs") {
    result.czech = {
      subject: outputPurpose === "summary" ? title || "Stručné shrnutí" : title || "Přehled produktu",
      opening:
        outputPurpose === "summary"
          ? `${title || "Tento produkt"} ve zkratce: ${description || "zdroj ukazuje reseni s jasnym byznysovym pouzitim a praktickymi funkcemi."}`
          : `Posilam kratky prehled produktu ${title || ""}. ${description || "Jde o reseni s jasnym byznysovym zamerenim a praktickym prinosem."} Podle zdroje jde o produkt, ktery se da klientovi vysvetlit rychle a srozumitelne.`.trim(),
      keyPoints: formatBulletBlock(
        combinedFeatures,
        "- Ve zdroji nebylo dost jednoznacnych informaci pro lepsi automaticke shrnuti funkci.",
      ),
      plans: pricing.length
        ? [
            hasPackages ? "Z cenove casti jsou nejdulezitejsi tyto body:" : "Z cenove casti jsou nejdulezitejsi tyto body:",
            formatBulletBlock(pricing, ""),
          ].join("\n")
        : "- Zdroj neukazuje jasne rozdeleni balicku ani ceniku.",
      closing:
        outputPurpose === "summary"
          ? `Pro vice detailu je zdroj tady: ${url}`
          : `Pokud to bude pro tebe relevantni, rada poslu vic detailu, ale kompletni zdrojova stranka je tady: ${url}`,
      sourceNote: outputPurpose === "summary" ? `Zdroj: ${url}` : `Vice informaci: ${url}`,
    };
  }

  return result;
}

async function fetchSourceFromUrl(rawUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Please enter a valid URL.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  const response = await fetch(parsedUrl, {
    headers: {
      "User-Agent": "easifier/1.0 (+local summary assistant)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Source fetch failed with status ${response.status}.`);
  }

  const html = await response.text();
  const { title, description, chunks, headings } = extractHtmlParts(html);
  const combinedText = uniqueLines([title, description, ...chunks]).join("\n");

  return {
    url: parsedUrl.toString(),
    title,
    description,
    headings,
    extractedText: trimForModel(combinedText, 24000),
    fetchedAt: new Date().toISOString(),
  };
}

function buildOpenAiSchema(languageMode) {
  const shouldIncludeEnglish = languageMode === "en" || languageMode === "both";
  const shouldIncludeCzech = languageMode === "cs" || languageMode === "both";

  const sectionSchema = {
    type: "object",
    additionalProperties: false,
    required: ["subject", "opening", "keyPoints", "plans", "closing", "sourceNote"],
    properties: {
      subject: { type: "string" },
      opening: { type: "string" },
      keyPoints: { type: "string" },
      plans: { type: "string" },
      closing: { type: "string" },
      sourceNote: { type: "string" },
    },
  };

  const properties = {
    sourceUrl: { type: "string" },
    extractedTitle: { type: "string" },
  };
  const required = ["sourceUrl", "extractedTitle"];

  if (shouldIncludeEnglish) {
    properties.english = sectionSchema;
    required.push("english");
  }

  if (shouldIncludeCzech) {
    properties.czech = sectionSchema;
    required.push("czech");
  }

  return {
    name: "easifier_summary",
    schema: {
      type: "object",
      additionalProperties: false,
      required,
      properties,
    },
    strict: true,
  };
}

async function generateWithOpenAI({
  apiKey,
  url,
  title,
  extractedText,
  languageMode,
  outputPurpose,
  extraInstructions,
}) {
  const schema = buildOpenAiSchema(languageMode);
  const instructions = [
    outputPurpose === "summary"
      ? "You are writing short internal product summaries."
      : "You are writing short client-facing product emails.",
    "Do not summarize the whole source page section by section.",
    outputPurpose === "summary"
      ? "Identify only the most relevant points and turn them into a concise practical summary."
      : "Instead, identify only the most commercially relevant points and turn them into a concise email draft.",
    "Keep the tone human, concise, clear, commercially useful, and mildly engaging.",
    "Avoid hype, fluff, feature dumps, and exaggerated marketing language.",
    "Prioritize these extraction goals in this exact order: what the product is, who it is for, the 3 to 5 most relevant features or benefits, and pricing/packages/versions.",
    "These rules must work for any product website, not only travel websites or SaaS pages.",
    "Focus on what the product is, why it matters, the key differentiators, and a short explanation of package, version, and pricing differences when clearly available.",
    outputPurpose === "summary"
      ? "The result should feel like a compact briefing note, not a client email."
      : "The result should feel like a concise email to a client, not an internal summary.",
    outputPurpose === "summary"
      ? "Keep the flow practical and direct."
      : "The email must read like a natural note written to a client, with a clear beginning, middle, and end.",
    outputPurpose === "summary"
      ? "Avoid letter-style greetings."
      : "Use a warm, polished, client-friendly tone, but keep it concise and commercially useful.",
    outputPurpose === "summary"
      ? "Always include the source URL at the end so the reader can check more details."
      : "Always include the source URL in a natural read-more style closing so the client can explore more if interested.",
    outputPurpose === "summary"
      ? "Short paragraphs and bullets are fine."
      : "The opening should be 2 to 3 connected sentences, not a fragment or label.",
    outputPurpose === "summary"
      ? "Keep bullets selective."
      : "Key points should continue naturally from the opening and focus on client value, not raw feature dumping.",
    "Key points should be selective, not exhaustive.",
    "Do not invent package names, tiers, or features that are not clearly present in the source text.",
    "If there are no named plans, do not imply that plans exist. If there is pricing for one product only, summarize it as pricing rather than packages.",
    "If the page does not clearly define all plans, packages, or prices, say that carefully instead of inventing details.",
    "Always preserve the source URL in the structured response.",
    "Include a short pricing/packages recap whenever the source clearly provides fees, monthly pricing, implementation pricing, usage limits, or included volume.",
    "If the source provides multiple fees, compress them into a short practical recap instead of copying the whole table verbatim.",
    "When pricing is included, format it clearly as bullet points or a compact table-like structure, never as one long sentence.",
    "Use only one language, based on the requested language mode.",
    "Write output that is close to ready for sending to a client.",
  ].join(" ");

  const prompt = [
    `Source URL: ${url}`,
    `Detected title: ${title || "N/A"}`,
    `Requested language mode: ${languageMode}`,
    `Requested output type: ${outputPurpose}`,
    extraInstructions ? `Additional instructions: ${extraInstructions}` : "",
    "Source text:",
    extractedText,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: instructions }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          ...schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const outputText = payload.output_text || payload.output?.[0]?.content?.[0]?.text;
  if (!outputText) {
    throw new Error("OpenAI response did not include structured output text.");
  }

  const parsed = JSON.parse(outputText);
  return {
    mode: "openai",
    languageMode,
    outputPurpose,
    ...parsed,
  };
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

async function handleApi(req, res, pathname) {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      aiConfigured: Boolean(process.env.OPENAI_API_KEY),
      model: DEFAULT_MODEL,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/fetch-source") {
    const body = await readBody(req);
    const result = await fetchSourceFromUrl(body.url || "");
    sendJson(res, 200, result);
    return true;
  }

  if (req.method === "POST" && pathname === "/api/generate") {
    const body = await readBody(req);
    const url = body.url || "";
    const title = body.title || "";
    const extractedText = normalizeWhitespace(body.extractedText || "");
    const outputPurpose = ["email", "summary"].includes(body.outputPurpose) ? body.outputPurpose : "email";
    const languageMode = ["en", "cs"].includes(body.languageMode) ? body.languageMode : "en";
    const extraInstructions = normalizeWhitespace(body.extraInstructions || "");

    if (!url || !extractedText) {
      throw new Error("URL and extracted text are required.");
    }

    const apiKey = (body.apiKey || process.env.OPENAI_API_KEY || "").trim();

    if (apiKey) {
      const result = await generateWithOpenAI({
        apiKey,
        url,
        title,
        extractedText: trimForModel(extractedText),
        languageMode,
        outputPurpose,
        extraInstructions,
      });
      sendJson(res, 200, result);
      return true;
    }

    const fallback = buildFallbackSummary({
      url,
      title,
      extractedText,
      outputPurpose,
      languageMode,
    });
    sendJson(res, 200, fallback);
    return true;
  }

  return false;
}

async function serveStatic(req, res, pathname) {
  const safePath = isSafePath(pathname === "/" ? "/index.html" : pathname);
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stats = await fsp.stat(filePath);
    if (stats.isDirectory()) {
      sendText(res, 403, "Forbidden");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, pathname);
      if (!handled) {
        sendJson(res, 404, { error: "API route not found." });
      }
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  console.log(`easifier app running at http://localhost:${PORT}`);
});
