const OPENAI_MODEL = "gpt-5-mini";

const state = {
  generated: null,
};

const els = {
  healthBadge: document.getElementById("healthBadge"),
  sourceUrl: document.getElementById("sourceUrl"),
  sourceFile: document.getElementById("sourceFile"),
  sourceTitle: document.getElementById("sourceTitle"),
  sourceText: document.getElementById("sourceText"),
  extraInstructions: document.getElementById("extraInstructions"),
  outputPurpose: document.getElementById("outputPurpose"),
  languageMode: document.getElementById("languageMode"),
  outputMode: document.getElementById("outputMode"),
  apiKey: document.getElementById("apiKey"),
  resultText: document.getElementById("resultText"),
  statusMessage: document.getElementById("statusMessage"),
  fetchBtn: document.getElementById("fetchBtn"),
  loadDemoBtn: document.getElementById("loadDemoBtn"),
  clearSourceBtn: document.getElementById("clearSourceBtn"),
  generateBtn: document.getElementById("generateBtn"),
  clearBtn: document.getElementById("clearBtn"),
  copyBtn: document.getElementById("copyBtn"),
  copySubjectBtn: document.getElementById("copySubjectBtn"),
  downloadTxtBtn: document.getElementById("downloadTxtBtn"),
  downloadMdBtn: document.getElementById("downloadMdBtn"),
  downloadHtmlBtn: document.getElementById("downloadHtmlBtn"),
  mailtoBtn: document.getElementById("mailtoBtn"),
};

function setStatus(message, isError = false) {
  els.statusMessage.textContent = message;
  els.statusMessage.style.color = isError ? "#a12d2d" : "";
}

function setButtonBusy(button, busy, labelWhenBusy) {
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy ? labelWhenBusy : button.dataset.defaultLabel;
}

function decodeEntities(input) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = input;
  return textarea.value;
}

function normalizeWhitespace(input) {
  return input
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimForModel(text, maxChars = 18000) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n[Content truncated for processing]`;
}

function uniqueLines(lines) {
  const seen = new Set();
  const result = [];
  for (const raw of lines) {
    const line = normalizeWhitespace(raw || "");
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

function formatPlainLineBlock(lines, emptyMessage) {
  if (!lines.length) {
    return emptyMessage;
  }
  return lines.map((line) => sentenceCase(line)).join("\n");
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
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, svg, img").forEach((node) => node.remove());

  const title = normalizeWhitespace(doc.querySelector("title")?.textContent || "");
  const description = normalizeWhitespace(doc.querySelector('meta[name="description"]')?.content || "");
  const chunks = uniqueLines(
    [...doc.querySelectorAll("h1, h2, h3, p, li")].map((node) => decodeEntities(node.textContent || "")),
  );

  return {
    title,
    description,
    extractedText: trimForModel(uniqueLines([title, description, ...chunks]).join("\n"), 24000),
  };
}

function extractPlainTextFromHtml(html) {
  return extractHtmlParts(html).extractedText;
}

function inferTitleFromReaderText(text, fallbackUrl) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const heading = lines.find((line) => line.startsWith("# "));
  if (heading) {
    return heading.replace(/^#\s+/, "").trim();
  }

  const titleLine = lines.find((line) => /^title:\s*/i.test(line));
  if (titleLine) {
    return titleLine.replace(/^title:\s*/i, "").trim();
  }

  try {
    return new URL(fallbackUrl).hostname;
  } catch {
    return fallbackUrl;
  }
}

async function extractTextFromImage(file) {
  if (!window.Tesseract) {
    throw new Error("Image OCR is not available right now.");
  }

  const result = await window.Tesseract.recognize(file, "eng");
  return normalizeWhitespace(result?.data?.text || "");
}

async function extractTextFromPdf(file) {
  if (!window.pdfjsLib) {
    throw new Error("PDF support is not available right now.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return normalizeWhitespace(pages.join("\n\n"));
}

async function extractTextFromDocx(file) {
  if (!window.mammoth) {
    throw new Error("DOCX support is not available right now.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return normalizeWhitespace(result.value || "");
}

async function extractTextFromFile(file) {
  const name = file.name || "uploaded-file";
  const lowerName = name.toLowerCase();

  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(lowerName)) {
    return {
      title: name.replace(/\.[^.]+$/, ""),
      text: await extractTextFromImage(file),
    };
  }

  if (lowerName.endsWith(".pdf")) {
    return {
      title: name.replace(/\.[^.]+$/, ""),
      text: await extractTextFromPdf(file),
    };
  }

  if (lowerName.endsWith(".docx")) {
    return {
      title: name.replace(/\.[^.]+$/, ""),
      text: await extractTextFromDocx(file),
    };
  }

  const rawText = await file.text();
  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
    return {
      title: name.replace(/\.[^.]+$/, ""),
      text: extractPlainTextFromHtml(rawText),
    };
  }

  return {
    title: name.replace(/\.[^.]+$/, ""),
    text: normalizeWhitespace(rawText),
  };
}

function buildFallbackSummary({ url, title, extractedText, languageMode, outputPurpose }) {
  const { description, audience, features, facts, pricing, hasPackages } = buildHeuristicContent({ title, extractedText });
  const descriptionLower = description.toLowerCase();
  const seenFeatures = new Set([descriptionLower]);
  const combinedFeatures = [...audience, ...features, ...facts]
    .filter((line) => {
      const lower = line.toLowerCase();
      if (seenFeatures.has(lower)) return false;
      seenFeatures.add(lower);
      return true;
    })
    .slice(0, 5);
  const listFormatter = outputPurpose === "email" ? formatPlainLineBlock : formatBulletBlock;

  const result = {
    mode: "fallback",
    sourceUrl: url,
    extractedTitle: title,
    languageMode,
    outputPurpose,
  };

  if (languageMode === "en") {
    result.english = {
      subject:
        outputPurpose === "summary"
          ? title || "Short summary"
          : `${title || "Product"} - Overview + Plans & Pricing`,
      opening:
        outputPurpose === "summary"
          ? `${title || "This product"} in short: ${description || "the source presents a product with a clear business use case and practical feature set."}`
          : `I'd like to share a quick overview of ${title || "this product"}.\n\n${description || "It appears to offer a practical solution with a clear business focus."}`,
      keyPoints:
        outputPurpose === "summary"
          ? formatBulletBlock(
              combinedFeatures,
              "- The source did not expose enough clear feature detail for a stronger automatic summary.",
            )
          : combinedFeatures.length
            ? `Key product highlights:\n${combinedFeatures.map((f) => `- ${sentenceCase(f)}`).join("\n")}`
            : "Key product highlights:\n- The source did not expose enough clear feature detail for an automatic summary.",
      plans:
        pricing.length
          ? outputPurpose === "summary"
            ? formatBulletBlock(pricing, "")
            : `Plans at a glance (public pricing):\n\n${pricing.map((p, i) => `${i + 1}) ${sentenceCase(p)}`).join("\n\n")}`
          : outputPurpose === "email"
            ? "Pricing is available on request."
            : "- Pricing details are available on request.",
      closing:
        outputPurpose === "summary"
          ? `For more details, see the source here: ${url}`
          : `If useful, I can also send a more detailed breakdown.\n\nMore details: ${url}\n\nBest regards,\n[Your Name]`,
      sourceNote: outputPurpose === "summary" ? `Source: ${url}` : `More details: ${url}`,
    };
  }

  if (languageMode === "cs") {
    result.czech = {
      subject:
        outputPurpose === "summary"
          ? title || "Stručné shrnutí"
          : `${title || "Produkt"} – přehled a ceník`,
      opening:
        outputPurpose === "summary"
          ? `${title || "Tento produkt"} ve zkratce: ${description || "zdroj ukazuje řešení s jasným byznysovým použitím a praktickými funkcemi."}`
          : `Posílám stručný přehled produktu ${title || ""}.\n\n${description || "Jde o řešení s jasným byznysovým zaměřením a praktickým přínosem."}`.trim(),
      keyPoints:
        outputPurpose === "summary"
          ? formatBulletBlock(
              combinedFeatures,
              "- Ve zdroji nebylo dost jednoznačných informací pro lepší automatické shrnutí funkcí.",
            )
          : combinedFeatures.length
            ? `Klíčové vlastnosti produktu:\n${combinedFeatures.map((f) => `- ${sentenceCase(f)}`).join("\n")}`
            : "Klíčové vlastnosti produktu:\n- Ve zdroji nebylo dost jednoznačných informací pro automatické shrnutí.",
      plans:
        pricing.length
          ? outputPurpose === "summary"
            ? formatBulletBlock(pricing, "")
            : `Přehled plánů a cen:\n\n${pricing.map((p, i) => `${i + 1}) ${sentenceCase(p)}`).join("\n\n")}`
          : outputPurpose === "email"
            ? "Cenové podmínky jsou dostupné na vyžádání."
            : "- Zdroj neukazuje jasné rozdělení balíčků ani ceníku.",
      closing:
        outputPurpose === "summary"
          ? `Pro více detailů je zdroj tady: ${url}`
          : `Pokud bude zájem, ráda pošlu podrobnější přehled.\n\nVíce informací: ${url}\n\nS pozdravem,\n[Vaše jméno]`,
      sourceNote: outputPurpose === "summary" ? `Zdroj: ${url}` : `Více informací: ${url}`,
    };
  }

  return result;
}

function buildSchema(languageMode) {
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

  if (languageMode === "en") {
    properties.english = sectionSchema;
    required.push("english");
  }
  if (languageMode === "cs") {
    properties.czech = sectionSchema;
    required.push("czech");
  }

  return {
    type: "json_schema",
    name: "easifier_summary",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    },
  };
}

async function generateWithOpenAI({ apiKey, url, title, extractedText, languageMode, outputPurpose, extraInstructions }) {
  const languageName = languageMode === "cs" ? "Czech" : "English";
  const instructions = [
    outputPurpose === "summary"
      ? "You are writing short internal product summaries."
      : "You are writing short, polished, client-ready product emails.",

    outputPurpose === "summary"
      ? "GOAL\nTurn the source text into a compact briefing note a colleague can read in under a minute."
      : "GOAL\nTurn the source text into a concise, natural client email that is close to ready-to-send. It must read like a thoughtful note written by a person, not a marketing brochure or a feature dump.",

    "EXTRACTION PRIORITY (follow in this order)\n1. What the product is and who it is for\n2. The 3 to 5 most commercially relevant features or benefits\n3. Pricing, packages, or version differences — only when clearly stated in the source",

    "TONE\nWarm, professional, commercially useful. No hype, no exclamation marks, no phrases like 'game-changing' or 'cutting-edge'.",

    [
      "FIELD FORMAT",
      `subject: ${
        outputPurpose === "summary"
          ? "Short descriptive title for the summary."
          : "Descriptive email subject line in the format: 'Product Name - Brief Description of What This Email Covers' (e.g., 'GOL IBE - Product Overview + Plans & Pricing')."
      }`,
      `opening: ${
        outputPurpose === "summary"
          ? "1 to 2 sentences. State what the product is and who it is for."
          : "Write 1 brief intro sentence on the first line (e.g., 'I'd like to share a quick overview of [Product] by [Company].'). Then a blank line. Then 2-3 paragraphs explaining what the product is, who it is for, and what core value it delivers to the client."
      }`,
      `keyPoints: ${
        outputPurpose === "summary"
          ? "Short list. One fact or benefit per line. Use - as bullet marker. Maximum 5 items."
          : "Write 'Key product highlights:' on the first line. Then list 5-7 bullet points using - as the marker. Each bullet should be a specific, concrete capability or benefit — not vague marketing language."
      }`,
      `plans: ${
        outputPurpose === "summary"
          ? "If pricing or packages are visible, list each on its own line. If not, write one sentence saying so."
          : "Write 'Plans at a glance (public pricing):' on the first line, then a blank line. For each named plan write 'N) Plan name' as a numbered heading, then bullet points (using -) for each pricing item and key limit. After all plans, if additional fees or conditions are mentioned, add a blank line then 'Additional cost notes:' and list them as bullets. Use blank lines between plan blocks. If no named plans exist, describe the pricing clearly. If no pricing at all, write: 'Pricing is available on request.'"
      }`,
      `closing: ${
        outputPurpose === "summary"
          ? "One sentence pointing to the source URL."
          : "Write 1 sentence inviting the client to request more details or a tailored recommendation. Then on a new line write 'More details: [source url]'. Then a blank line, then 'Best regards,' and on the next line '[Your Name]'."
      }`,
      "sourceNote: The source URL only.",
    ].join("\n"),

    [
      "STRICT RULES",
      outputPurpose === "email"
        ? "Never use *, **, ***, #, ##, or any markdown formatting in any field. The only allowed list marker is - for bullet points and N) for numbered plan headings. No bold, no italic, no headings."
        : "Markdown bullets are acceptable in keyPoints and plans.",
      outputPurpose === "email"
        ? "The source URL must appear exactly once, only in the closing field. Do not include it in opening, keyPoints, or plans."
        : "",
      "No invented features, package names, or prices — only what is clearly stated in the source.",
      "Only mention package names (Standard, Basic, Enhanced, Enterprise, etc.) if they appear in the source.",
      "If pricing is for one product only, call it 'pricing', not 'packages' or 'tiers'.",
      "If version or pricing details are unclear, say so briefly instead of guessing.",
      `Write the entire output in ${languageName} only. No mixed languages.`,
      "Output must be close to ready for sending.",
    ].join("\n"),
  ].join("\n\n");

  const prompt = [
    `Source URL: ${url}`,
    `Detected title: ${title || "N/A"}`,
    `Requested language mode: ${languageMode}`,
    `Requested output type: ${outputPurpose}`,
    extraInstructions ? `Additional instructions: ${extraInstructions}` : "",
    "Source text:",
    trimForModel(extractedText),
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
      model: OPENAI_MODEL,
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
        format: buildSchema(languageMode),
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${details}`);
  }

  const payload = await response.json();
  const outputText = payload.output_text || payload.output?.[0]?.content?.[0]?.text;
  if (!outputText) {
    throw new Error("OpenAI response did not include output text.");
  }

  return {
    mode: "openai",
    languageMode,
    ...JSON.parse(outputText),
  };
}

function toMarkdownBlock(title, data, sourceUrl, outputPurpose) {
  if (!data) {
    return "";
  }
  if (outputPurpose === "email") {
    const { greeting } = getEmailBridgeText();
    const kp = (data.keyPoints || "").trim();
    const parts = [greeting, "", data.opening];
    if (kp) parts.push("", kp);
    parts.push("", data.plans || "", "", data.closing);
    return parts.join("\n");
  }
  return [data.opening, "", data.keyPoints, "", data.plans, "", data.closing].join("\n");
}

function toPlainBlock(title, data, sourceUrl, outputPurpose) {
  if (!data) {
    return "";
  }
  if (outputPurpose === "email") {
    const { greeting } = getEmailBridgeText();
    const kp = (data.keyPoints || "").trim();
    const parts = [greeting, "", data.opening];
    if (kp) parts.push("", kp);
    parts.push("", data.plans || "", "", data.closing);
    return parts.join("\n");
  }
  return [data.opening, "", data.keyPoints, "", data.plans, "", data.closing].join("\n");
}

function escapeHtml(input) {
  return (input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtmlParagraphs(input) {
  return (input || "")
    .split(/\n{2,}/)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function getEmailBridgeText() {
  if (els.languageMode.value === "cs") {
    return {
      greeting: "Dobrý den,",
      bridge: "Z toho nejdůležitějšího, co je na zdroji vidět:",
    };
  }

  return {
    greeting: "Hello,",
    bridge: "The main points that seem most relevant are:",
  };
}

function normalizeEmailLines(input) {
  return (input || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*#•·]+\s*/, ""))
    .join("\n");
}

function toEmailMarkdownList(input) {
  return normalizeEmailLines(input)
    .split("\n")
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join("\n");
}

function toEmailHtmlList(input) {
  const lines = normalizeEmailLines(input).split("\n").filter(Boolean);
  if (!lines.length) return "";
  return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
}

function renderEmailBlockHtml(input) {
  if (!input) return "";
  const lines = input.split("\n");
  const out = [];
  let listOpen = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (listOpen) { out.push("</ul>"); listOpen = false; }
      continue;
    }
    if (/^-\s+/.test(line)) {
      if (!listOpen) { out.push("<ul>"); listOpen = true; }
      out.push(`<li>${escapeHtml(line.replace(/^-\s+/, ""))}</li>`);
    } else {
      if (listOpen) { out.push("</ul>"); listOpen = false; }
      if (/^\d+[).]\s+/.test(line)) {
        out.push(`<p><strong>${escapeHtml(line)}</strong></p>`);
      } else {
        out.push(`<p>${escapeHtml(line)}</p>`);
      }
    }
  }
  if (listOpen) out.push("</ul>");
  return out.join("");
}

function toHtmlBlock(title, data, sourceUrl, outputPurpose) {
  if (!data) {
    return "";
  }
  if (outputPurpose === "email") {
    const { greeting } = getEmailBridgeText();
    const kp = (data.keyPoints || "").trim();
    return [
      "<section>",
      `<p>${escapeHtml(greeting)}</p>`,
      textToHtmlParagraphs(data.opening),
      kp ? renderEmailBlockHtml(kp) : "",
      renderEmailBlockHtml(data.plans || ""),
      textToHtmlParagraphs(data.closing),
      "</section>",
    ].join("");
  }
  return [
    "<section>",
    textToHtmlParagraphs(data.opening),
    renderEmailBlockHtml(data.keyPoints || ""),
    renderEmailBlockHtml(data.plans || ""),
    textToHtmlParagraphs(data.closing),
    "</section>",
  ].join("");
}

function sanitizeEmailField(text) {
  if (!text) return text;
  return text
    .replace(/^\*\s+/gm, "- ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1");
}

function deduplicateUrl(text, url) {
  if (!url || !text) return text;
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "g");
  const matches = [...text.matchAll(regex)];
  if (matches.length <= 1) return text;
  let count = 0;
  return text.replace(regex, () => (++count < matches.length ? "" : url));
}

function buildOutputs(generated) {
  const outputMode = els.outputMode.value;
  const sourceUrl = generated.sourceUrl || els.sourceUrl.value.trim();
  const selectedLanguage = els.languageMode.value;
  const outputPurpose = els.outputPurpose.value;
  const raw = selectedLanguage === "cs" ? generated.czech : generated.english;
  if (!raw) return "";

  const data =
    outputPurpose === "email"
      ? {
          ...raw,
          opening: sanitizeEmailField(raw.opening),
          keyPoints: sanitizeEmailField(raw.keyPoints),
          plans: sanitizeEmailField(raw.plans),
          closing: sanitizeEmailField(raw.closing),
        }
      : raw;

  const render = { plain: toPlainBlock, markdown: toMarkdownBlock, html: toHtmlBlock }[outputMode];
  let body = render("", data, sourceUrl, outputPurpose);

  if (outputPurpose === "email") {
    if (outputMode !== "html") body = deduplicateUrl(body, sourceUrl);
    if (data.subject) {
      if (outputMode === "html") {
        return `<p><strong>Subject: ${escapeHtml(data.subject)}</strong></p>${body}`;
      }
      return `Subject: ${data.subject}\n\n${body}`;
    }
  }
  return body;
}

function updateOutput() {
  if (!state.generated) {
    els.resultText.value = "";
    return;
  }
  els.resultText.value = buildOutputs(state.generated) || "";
}

async function copyToClipboard(text, successMessage) {
  if (!text) {
    setStatus("Nothing to copy yet.", true);
    return;
  }
  await navigator.clipboard.writeText(text);
  setStatus(successMessage);
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function getFilenameBase() {
  const title = (els.sourceTitle.value || "summary")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return title || "summary";
}

function buildEmailSubject() {
  if (els.outputPurpose.value === "summary") {
    return state.generated?.extractedTitle || els.sourceTitle.value || "Short summary";
  }
  return (
    (els.languageMode.value === "cs" ? state.generated?.czech?.subject : state.generated?.english?.subject) ||
    state.generated?.extractedTitle ||
    els.sourceTitle.value ||
    "Product overview"
  );
}

function loadDemo() {
  els.sourceUrl.value = "https://www.cee-systems.com/solutions/gol-ibe";
  els.sourceTitle.value = "GOL IBE";
  els.extraInstructions.value =
    "Write this as a short, polished client email in English. Keep only the key points, include pricing or versions only if clearly stated, do not invent tiers, and end with one natural source link.";
  els.outputPurpose.value = "email";
  els.languageMode.value = "en";
  els.sourceText.value = [
    "GOL IBE",
    "Online booking engine for travel agencies.",
    "Sell air tickets through your website.",
    "Includes GDS, low-cost, NDC, and rail content.",
    "Supports one-way, return, and multi-city search.",
    "Offers branded fares, baggage details, promo codes, online payment, manual and automated ticketing.",
    "Includes admin console, service fee settings, airline commissions, dealer sales, Flight Watchdog, MultiPCC, custom domain, and meta-search integration.",
    "Pricing details may vary depending on setup and selected scope.",
    "Enhanced: $210/month, Travelport+ fee $1.43, deposit $630/year, includes around 250 Flight Watchdog watchers and up to 20 dealers.",
    "Enterprise: $460/month, Travelport+ fee $1.19, deposit $940/year, includes around 500 watchers, up to 250 dealers, MultiPCC, custom domain, automated e-ticketing, manual ticketing, meta-search integration.",
  ].join("\n");
  setStatus("Demo content loaded.");
}

async function fetchSource() {
  const url = els.sourceUrl.value.trim();
  if (!url) {
    setStatus("Please enter a source URL first.", true);
    return;
  }

  try {
    setButtonBusy(els.fetchBtn, true, "Trying...");
    setStatus("Fetching the source page through the reader service...");
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const readerUrl = `https://r.jina.ai/http://${normalizedUrl.replace(/^https?:\/\//i, "")}`;
    const response = await fetch(readerUrl);
    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}.`);
    }
    const readerText = normalizeWhitespace(await response.text());
    els.sourceTitle.value = els.sourceTitle.value || inferTitleFromReaderText(readerText, normalizedUrl);
    els.sourceText.value = readerText || "";
    els.sourceUrl.value = normalizedUrl;
    setStatus("Source fetched successfully. If the result looks incomplete, paste the source text manually.");
  } catch (error) {
    setStatus(
      `Reader fetch failed. Paste the source text manually and continue. Details: ${error.message}`,
      true,
    );
  } finally {
    setButtonBusy(els.fetchBtn, false);
  }
}

async function generateSummary() {
  const url = els.sourceUrl.value.trim();
  const extractedText = normalizeWhitespace(els.sourceText.value || "");
  const title = els.sourceTitle.value.trim();

  if (!url || !extractedText) {
    setStatus("Please provide a source URL and source text.", true);
    return;
  }

  try {
    setButtonBusy(els.generateBtn, true, "Generating...");
    setStatus(els.outputPurpose.value === "summary" ? "Generating short summary..." : "Generating short client-ready email...");

    const apiKey = els.apiKey.value.trim();
    const outputPurpose = els.outputPurpose.value;
    const languageMode = els.languageMode.value;
    const extraInstructions = els.extraInstructions.value.trim();

    state.generated = apiKey
      ? await generateWithOpenAI({ apiKey, url, title, extractedText, languageMode, outputPurpose, extraInstructions })
      : buildFallbackSummary({ url, title, extractedText, languageMode, outputPurpose });

    updateOutput();
    setStatus(
      apiKey
        ? outputPurpose === "summary"
          ? "Short summary is ready."
          : "Email-style output is ready. Copy it, download it, or open a mail draft."
        : outputPurpose === "summary"
          ? "Fallback short summary is ready. Add an OpenAI API key for a sharper version."
          : "Fallback email draft is ready. Add an OpenAI API key for a sharper client-facing version.",
    );
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonBusy(els.generateBtn, false);
  }
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    setStatus(`Reading file: ${file.name}...`);
    const extracted = await extractTextFromFile(file);
    els.sourceTitle.value = els.sourceTitle.value || extracted.title;
    els.sourceText.value = extracted.text || "";
    if (!els.sourceUrl.value.trim()) {
      els.sourceUrl.value = `Uploaded file: ${file.name}`;
    }
    setStatus(`File loaded: ${file.name}. You can generate the email now.`);
  } catch (error) {
    setStatus(`Could not read the uploaded file. ${error.message}`, true);
  }
}

function clearSource() {
  els.sourceUrl.value = "";
  els.sourceTitle.value = "";
  els.sourceText.value = "";
  els.extraInstructions.value = "";
  setStatus("Source fields cleared.");
}

function clearOutput() {
  state.generated = null;
  els.resultText.value = "";
  setStatus("Output cleared.");
}

function openMailDraft() {
  const subject = buildEmailSubject();
  const body = els.resultText.value.trim();
  if (!body) {
    setStatus("Generate output first, then open the mail draft.", true);
    return;
  }
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

els.healthBadge.textContent = `Browser mode (${OPENAI_MODEL})`;
els.fetchBtn.addEventListener("click", fetchSource);
els.sourceFile.addEventListener("change", handleFileUpload);
els.loadDemoBtn.addEventListener("click", loadDemo);
els.clearSourceBtn.addEventListener("click", clearSource);
els.generateBtn.addEventListener("click", generateSummary);
els.clearBtn.addEventListener("click", clearOutput);
els.copyBtn.addEventListener("click", () => copyToClipboard(els.resultText.value, "Output copied to clipboard."));
els.copySubjectBtn.addEventListener("click", () =>
  copyToClipboard(buildEmailSubject(), "Email subject copied to clipboard."),
);
els.downloadTxtBtn.addEventListener("click", () =>
  downloadBlob(`${getFilenameBase()}.txt`, els.resultText.value, "text/plain;charset=utf-8"),
);
els.downloadMdBtn.addEventListener("click", () => {
  const previousMode = els.outputMode.value;
  els.outputMode.value = "markdown";
  updateOutput();
  downloadBlob(`${getFilenameBase()}.md`, els.resultText.value, "text/markdown;charset=utf-8");
  els.outputMode.value = previousMode;
  updateOutput();
});
els.downloadHtmlBtn.addEventListener("click", () => {
  const previousMode = els.outputMode.value;
  els.outputMode.value = "html";
  updateOutput();
  const wrappedHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    buildEmailSubject(),
  )}</title></head><body>${els.resultText.value}</body></html>`;
  downloadBlob(`${getFilenameBase()}.html`, wrappedHtml, "text/html;charset=utf-8");
  els.outputMode.value = previousMode;
  updateOutput();
});
els.mailtoBtn.addEventListener("click", openMailDraft);
els.outputMode.addEventListener("change", updateOutput);
els.outputPurpose.addEventListener("change", updateOutput);
els.languageMode.addEventListener("change", updateOutput);
