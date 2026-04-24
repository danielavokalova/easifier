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
  const instructions = [
    outputPurpose === "summary"
      ? "You are writing short internal product summaries."
      : "You are writing short client-facing product emails.",
    "Do not summarize the entire source page section by section.",
    outputPurpose === "summary"
      ? "Identify only the most relevant points and turn them into a concise practical summary."
      : "Instead, identify only the most commercially relevant points and turn them into a concise email draft.",
    "Keep the tone human, clear, short, practical, commercially useful, and mildly engaging.",
    "Avoid hype, repetition, feature dumps, and filler.",
    "Focus on what the product is, why it matters, the key differentiators, and a short explanation of package, version, and pricing differences when clearly available.",
    outputPurpose === "summary"
      ? "The result should feel like a compact briefing note, not a client email."
      : "The result should feel like a concise email to a client, not an internal summary.",
    outputPurpose === "summary"
      ? "Always include the source URL at the end so the reader can check more details."
      : "Always include the source URL in a natural read-more style closing so the client can explore more if interested.",
    "Key points should be selective, not exhaustive.",
    "Do not invent package names, tiers, or features that are not clearly present in the source text.",
    "If version, package, or pricing details are unclear, state that carefully instead of inventing them.",
    "Always preserve the source URL.",
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
    data.opening,
    "",
    data.keyPoints,
    "",
    data.plans,
    "",
    data.closing,
  ].join("\n");
}

function toPlainBlock(title, data, sourceUrl) {
  if (!data) {
    return "";
  }
  return [
    data.opening,
    "",
    data.keyPoints,
    "",
    data.plans,
    "",
    data.closing,
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
    textToHtmlParagraphs(data.opening),
    textToHtmlParagraphs(data.keyPoints),
    textToHtmlParagraphs(data.plans),
    textToHtmlParagraphs(data.closing),
    "</section>",
  ].join("");
}

function buildOutputs(generated) {
  const outputMode = els.outputMode.value;
  const sourceUrl = generated.sourceUrl || els.sourceUrl.value.trim();
  const selectedLanguage = els.languageMode.value;
  const data = selectedLanguage === "cs" ? generated.czech : generated.english;

  const render = {
    plain: toPlainBlock,
    markdown: toMarkdownBlock,
    html: toHtmlBlock,
  }[outputMode];

  return data ? render("", data, sourceUrl) : "";
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
    "Write this as a short, friendly client email. Keep only the key points, include pricing/packages only if clearly stated, do not invent tiers, and end with one natural source link.";
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

loadDemo();
