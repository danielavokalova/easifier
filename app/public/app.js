const state = {
  generated: null,
  activeTab: "combined",
};

const els = {
  healthBadge: document.getElementById("healthBadge"),
  sourceUrl: document.getElementById("sourceUrl"),
  sourceFile: document.getElementById("sourceFile"),
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
  els.statusMessage.style.color = isError ? "#9b2c2c" : "";
}

function setButtonBusy(button, busy, labelWhenBusy) {
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy ? labelWhenBusy : button.dataset.defaultLabel;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function normalizeWhitespace(input) {
  return input.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function extractHtmlParts(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, svg, img").forEach((node) => node.remove());
  const title = normalizeWhitespace(doc.querySelector("title")?.textContent || "");
  const description = normalizeWhitespace(doc.querySelector('meta[name="description"]')?.content || "");
  const chunks = [...doc.querySelectorAll("h1, h2, h3, p, li")]
    .map((node) => normalizeWhitespace(node.textContent || ""))
    .filter(Boolean);
  return {
    title,
    extractedText: [title, description, ...chunks].filter(Boolean).join("\n"),
  };
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
    const extracted = extractHtmlParts(rawText);
    return {
      title: extracted.title || name.replace(/\.[^.]+$/, ""),
      text: normalizeWhitespace(extracted.extractedText || ""),
    };
  }

  return {
    title: name.replace(/\.[^.]+$/, ""),
    text: normalizeWhitespace(rawText),
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
    `${title}`,
    "",
    `Subject: ${data.subject}`,
    "",
    `${data.opening}`,
    "",
    `Key points`,
    `${data.keyPoints}`,
    "",
    `Plans / versions`,
    `${data.plans}`,
    "",
    `${data.closing}`,
    "",
    data.sourceNote || `Source: ${sourceUrl}`,
  ].join("\n");
}

function escapeHtml(input) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtmlParagraphs(input) {
  return input
    .split(/\n{2,}/)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function toHtmlBlock(title, data, sourceUrl) {
  if (!data) {
    return "";
  }
  return [
    `<section>`,
    `<h2>${escapeHtml(title)}</h2>`,
    `<p><strong>Subject:</strong> ${escapeHtml(data.subject)}</p>`,
    textToHtmlParagraphs(data.opening),
    `<h3>Key points</h3>`,
    textToHtmlParagraphs(data.keyPoints),
    `<h3>Plans / versions</h3>`,
    textToHtmlParagraphs(data.plans),
    textToHtmlParagraphs(data.closing),
    `<p><strong>${escapeHtml((data.sourceNote || "Source").split(":")[0])}:</strong> <a href="${escapeHtml(
      sourceUrl,
    )}">${escapeHtml(sourceUrl)}</a></p>`,
    `</section>`,
  ].join("");
}

function buildOutputs(generated) {
  const outputMode = els.outputMode.value;
  const sourceUrl = generated.sourceUrl || els.sourceUrl.value.trim();
  const english = generated.english || null;
  const czech = generated.czech || null;

  const renderers = {
    plain: toPlainBlock,
    markdown: toMarkdownBlock,
    html: toHtmlBlock,
  };
  const render = renderers[outputMode];

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
  const value = outputs[state.activeTab] || outputs.combined || "";
  els.resultText.value = value;
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
  if (!state.generated) {
    return els.sourceTitle.value || "Product overview";
  }
  return (
    state.generated.english?.subject ||
    state.generated.czech?.subject ||
    state.generated.extractedTitle ||
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

async function refreshHealth() {
  try {
    const payload = await requestJson("/api/health", { method: "GET" });
    els.healthBadge.textContent = payload.aiConfigured
      ? `AI ready (${payload.model})`
      : `No server key (${payload.model})`;
  } catch {
    els.healthBadge.textContent = "Server unavailable";
  }
}

async function fetchSource() {
  const url = els.sourceUrl.value.trim();
  if (!url) {
    setStatus("Please enter a source URL first.", true);
    return;
  }

  try {
    setButtonBusy(els.fetchBtn, true, "Fetching...");
    setStatus("Fetching the source page and extracting readable text...");
    const payload = await requestJson("/api/fetch-source", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    els.sourceTitle.value = payload.title || "";
    els.sourceText.value = payload.extractedText || "";
    setStatus("Source fetched successfully. You can generate the email now.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonBusy(els.fetchBtn, false);
  }
}

async function generateSummary() {
  const url = els.sourceUrl.value.trim();
  const extractedText = els.sourceText.value.trim();

  if (!url || !extractedText) {
    setStatus("Source URL and source text are required.", true);
    return;
  }

  try {
    setButtonBusy(els.generateBtn, true, "Generating...");
    setStatus("Generating short client-ready email...");
    const payload = await requestJson("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        url,
        title: els.sourceTitle.value.trim(),
        extractedText,
        languageMode: els.languageMode.value,
        apiKey: els.apiKey.value.trim(),
        extraInstructions: els.extraInstructions.value.trim(),
      }),
    });
    state.generated = payload;
    setActiveTab("combined");
    setStatus(
      payload.mode === "openai"
        ? "Email-style output is ready. Copy it or export it for email."
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

els.fetchBtn.addEventListener("click", fetchSource);
els.sourceFile.addEventListener("change", handleFileUpload);
els.loadDemoBtn.addEventListener("click", loadDemo);
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
els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
});

refreshHealth();
loadDemo();
