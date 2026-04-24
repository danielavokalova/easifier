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
  const sections = extractedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  const keyLines = sections
    .slice(1, 5)
    .map((line) => `- ${line}`)
    .join("\n");

  const planLines = sections
    .slice(5, 8)
    .map((line) => `- ${line}`)
    .join("\n");

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
          ? `Short summary of ${title || "this product"} based on the source content below.`
          : `I am sharing a short overview of ${title || "this product"} based on the source page below.`,
      keyPoints: keyLines || "- Main selling points were not extracted automatically.",
      plans: planLines || "- Pricing or package details were not extracted automatically.",
      closing:
        outputPurpose === "summary"
          ? `For more details, see the source here: ${url}`
          : `If you would like to explore the product in more detail, you can find the full source page here: ${url}`,
      sourceNote: outputPurpose === "summary" ? `Source: ${url}` : `Read more: ${url}`,
    };
  }

  if (languageMode === "cs") {
    result.czech = {
      subject: outputPurpose === "summary" ? title || "Stručné shrnutí" : title || "Přehled produktu",
      opening:
        outputPurpose === "summary"
          ? `Stručné shrnutí produktu ${title || ""} podle zdrojového obsahu níže.`.trim()
          : `Posílám krátký přehled produktu ${title || ""} podle zdrojové stránky níže.`.trim(),
      keyPoints: keyLines || "- Hlavní přínosy se nepodařilo automaticky vytěžit.",
      plans: planLines || "- Detaily cen nebo balíčků se nepodařilo automaticky vytěžit.",
      closing:
        outputPurpose === "summary"
          ? `Pro více detailů je zdroj tady: ${url}`
          : `Pokud si budeš chtít projít více detailů, kompletní zdrojová stránka je tady: ${url}`,
      sourceNote: outputPurpose === "summary" ? `Zdroj: ${url}` : `Více informací: ${url}`,
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
    "Focus on what the product is, why it matters, the key differentiators, and a short explanation of package, version, and pricing differences when clearly available.",
    outputPurpose === "summary"
      ? "The result should feel like a compact briefing note, not a client email."
      : "The result should feel like a concise email to a client, not an internal summary.",
    outputPurpose === "summary"
      ? "Always include the source URL at the end so the reader can check more details."
      : "Always include the source URL in a natural read-more style closing so the client can explore more if interested.",
    "Key points should be selective, not exhaustive.",
    "Do not invent package names, tiers, or features that are not clearly present in the source text.",
    "If the page does not clearly define all plans, packages, or prices, say that carefully instead of inventing details.",
    "Always preserve the source URL in the structured response.",
    "Include a short pricing/packages recap when the source clearly provides it.",
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
