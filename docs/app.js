const OPENAI_MODEL = "gpt-5-mini";

const state = {
  generated: null,
  activeTab: "combined",
};

const els = {
  healthBadge: document.getElementById("healthBadge"),
  sourceUrl: document.getElementById("sourceUrl"),
  sourceTitle: document.getElementById("sourceTitle"),
  sourceText: document.getElementById("sourceText"),
  extraInstructions: document.getElementById("extraInstructions"),
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
  tabs: Array.from(document.querySelectorAll(".tab")),
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

function buildFallbackSummary({ url, title, extractedText, languageMode }) {
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
  };

  if (languageMode === "en" || languageMode === "both") {
    result.english = {
      subject: title || "Product overview",
      opening: `I am sharing a short overview of ${title || "this product"} based on the source page below.`,
      keyPoints: keyLines || "- Main selling points were not extracted automatically.",
      plans: planLines || "- Plan details were not extracted automatically.",
      closing:
        `If you would like to explore the product in more detail, you can find the full source page here: ${url}`,
      sourceNote: `Read more: ${url}`,
    };
  }

  if (languageMode === "cs" || languageMode === "both") {
    result.czech = {
      subject: title || "Přehled produktu",
      opening: `Posílám krátký přehled produktu ${title || ""} podle zdrojové stránky níže.`.trim(),
      keyPoints: keyLines || "- Hlavní přínosy se nepodařilo automaticky vytěžit.",
      plans: planLines || "- Detaily variant se nepodařilo automaticky vytěžit.",
      closing:
        `Pokud si budeš chtít projít více detailů, kompletní zdrojová stránka je tady: ${url}`,
      sourceNote: `Více informací: ${url}`,
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

  if (languageMode === "en" || languageMode === "both") {
    properties.english = sectionSchema;
    required.push("english");
  }
  if (languageMode === "cs" || languageMode === "both") {
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

async function generateWithOpenAI({ apiKey, url, title, extractedText, languageMode, extraInstructions }) {
  const instructions = [
    "You are writing short client-facing product emails.",
    "Do not summarize the entire source page section by section.",
    "Instead, identify only the most commercially relevant points and turn them into a concise email draft.",
    "Keep the tone human, clear, short, practical, commercially useful, and mildly engaging.",
    "Avoid hype, repetition, feature dumps, and filler.",
    "Focus on what the product is, why it matters, the key differentiators, and a short explanation of plan/version differences when clearly available.",
    "The result should feel like a concise email to a client, not an internal summary.",
    "Always include the source URL in a natural read-more style closing so the client can explore more if interested.",
    "Key points should be selective, not exhaustive.",
    "If version details are unclear, state that carefully instead of inventing them.",
    "Always preserve the source URL.",
    "Write output that is close to ready for sending to a client.",
  ].join(" ");

  const prompt = [
    `Source URL: ${url}`,
    `Detected title: ${title || "N/A"}`,
    `Requested language mode: ${languageMode}`,
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

function toMarkdownBlock(title, data, sourceUrl) {
  if (!data) {
    return "";
  }
  return [
    `## ${title}`,
    "",
    `**Subject:** ${data.subject}`,
    "",
    data.opening,
    "",
    `**Key points**`,
    data.keyPoints,
    "",
    `**Plans / versions**`,
    data.plans,
    "",
    data.closing,
    "",
    data.sourceNote || `Source: ${sourceUrl}`,
  ].join("\n");
}

function toPlainBlock(title, data, sourceUrl) {
  if (!data) {
    return "";
  }
  return [
    title,
    "",
    `Subject: ${data.subject}`,
    "",
    data.opening,
    "",
    "Key points",
    data.keyPoints,
    "",
    "Plans / versions",
    data.plans,
    "",
    data.closing,
    "",
    data.sourceNote || `Source: ${sourceUrl}`,
  ].join("\n");
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

function toHtmlBlock(title, data, sourceUrl) {
  if (!data) {
    return "";
  }
  return [
    "<section>",
    `<h2>${escapeHtml(title)}</h2>`,
    `<p><strong>Subject:</strong> ${escapeHtml(data.subject)}</p>`,
    textToHtmlParagraphs(data.opening),
    "<h3>Key points</h3>",
    textToHtmlParagraphs(data.keyPoints),
    "<h3>Plans / versions</h3>",
    textToHtmlParagraphs(data.plans),
    textToHtmlParagraphs(data.closing),
    `<p><strong>${escapeHtml((data.sourceNote || "Source").split(":")[0])}:</strong> <a href="${escapeHtml(
      sourceUrl,
    )}">${escapeHtml(sourceUrl)}</a></p>`,
    "</section>",
  ].join("");
}

function buildOutputs(generated) {
  const outputMode = els.outputMode.value;
  const sourceUrl = generated.sourceUrl || els.sourceUrl.value.trim();
  const english = generated.english || null;
  const czech = generated.czech || null;

  const render = {
    plain: toPlainBlock,
    markdown: toMarkdownBlock,
    html: toHtmlBlock,
  }[outputMode];

  const pieces = {
    english: english ? render("English Version", english, sourceUrl) : "",
    czech: czech ? render("Czech Version", czech, sourceUrl) : "",
  };

  pieces.combined = [pieces.english, pieces.czech].filter(Boolean).join(outputMode === "html" ? "<hr>" : "\n\n");
  return pieces;
}

function updateOutput() {
  if (!state.generated) {
    els.resultText.value = "";
    return;
  }
  const outputs = buildOutputs(state.generated);
  els.resultText.value = outputs[state.activeTab] || outputs.combined || "";
}

function setActiveTab(tab) {
  state.activeTab = tab;
  for (const button of els.tabs) {
    button.classList.toggle("active", button.dataset.tab === tab);
  }
  updateOutput();
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
  return (
    state.generated?.english?.subject ||
    state.generated?.czech?.subject ||
    state.generated?.extractedTitle ||
    els.sourceTitle.value ||
    "Product overview"
  );
}

function loadDemo() {
  els.sourceUrl.value = "https://www.cee-systems.com/solutions/gol-ibe";
  els.sourceTitle.value = "GOL IBE";
  els.extraInstructions.value =
    "Write this like a short email to a client. Highlight only the most important commercial points, keep it brief, and always include a natural read-more link to the source page.";
  els.sourceText.value = [
    "GOL IBE",
    "Online booking engine for travel agencies.",
    "Sell air tickets through your website.",
    "Includes GDS, low-cost, NDC, and rail content.",
    "Supports one-way, return, and multi-city search.",
    "Offers branded fares, baggage details, promo codes, online payment, manual and automated ticketing.",
    "Includes admin console, service fee settings, airline commissions, dealer sales, Flight Watchdog, MultiPCC, custom domain, and meta-search integration.",
    "Plans: Standard, Enhanced, Enterprise.",
    "Standard: $0/month, Travelport+ fee $1.67, Travelfusion fee $3.60, deposit $390/year.",
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
    setStatus("Trying to fetch source text directly in the browser...");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}.`);
    }
    const html = await response.text();
    const extracted = extractHtmlParts(html);
    els.sourceTitle.value = extracted.title || els.sourceTitle.value;
    els.sourceText.value = extracted.extractedText || "";
    setStatus("Source fetched successfully. If the text looks incomplete, paste the source manually.");
  } catch (error) {
    setStatus(
      `Direct fetch was blocked or failed. Paste the source text manually and continue. Details: ${error.message}`,
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
    setStatus("Generating short client-ready email...");

    const apiKey = els.apiKey.value.trim();
    const languageMode = els.languageMode.value;
    const extraInstructions = els.extraInstructions.value.trim();

    state.generated = apiKey
      ? await generateWithOpenAI({ apiKey, url, title, extractedText, languageMode, extraInstructions })
      : buildFallbackSummary({ url, title, extractedText, languageMode });

    setActiveTab("combined");
    setStatus(
      apiKey
        ? "Email-style output is ready. Copy it, download it, or open a mail draft."
        : "Fallback email draft is ready. Add an OpenAI API key for a sharper client-facing version.",
    );
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonBusy(els.generateBtn, false);
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
els.tabs.forEach((tab) => tab.addEventListener("click", () => setActiveTab(tab.dataset.tab)));

loadDemo();
