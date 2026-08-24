import { App } from "@modelcontextprotocol/ext-apps";
import html2canvas from "html2canvas";

type Candidate = {
  id: string; name: string; source: string | null; edition: string | null; legacy: boolean;
  challengeRating: string | null; type: string | null; tags: string[]; url: string;
};
type Entry = { name: string | null; text: string };
type StatBlock = {
  kind: "stat_block";
  creature: { id: string; name: string; url: string; source: string | null; edition: string | null; legacy: boolean; size: string | null; type: string | null; alignment: string | null; tags: string[]; challengeRating: string | null };
  attributes: Array<{ label: string; value: string }>;
  abilities: Array<{ name: string; score: number | null; modifier: string | null; save: string | null }>;
  sections: Array<{ title: string; kind: string; entries: Entry[] }>;
  markdown: string;
};
type Resolution =
  | { kind: "resolved"; candidate: Candidate }
  | { kind: "candidates"; query: string; candidates: Candidate[] }
  | { kind: "not_found"; query: string };

const app = new App({ name: "Mysterium Stat Block Viewer", version: "1.0.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
const shell = document.querySelector<HTMLElement>("#app-shell")!;
const status = document.querySelector<HTMLElement>("#status")!;
const candidateList = document.querySelector<HTMLElement>("#candidate-list")!;
const card = document.querySelector<HTMLElement>("#stat-block")!;
const exportStage = document.querySelector<HTMLElement>("#export-stage")!;
const title = document.querySelector<HTMLElement>("#toolbar-title")!;
let current: StatBlock | null = null;
let loadingCandidateKey: string | null = null;
let zoom = 1;

function setStatus(message: string, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
  status.hidden = false;
  card.hidden = true;
  candidateList.hidden = true;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function badge(text: string) { return element("span", "badge", text); }

function toolResultError(result: { content?: unknown }, fallback: string) {
  if (Array.isArray(result.content)) {
    const message = result.content
      .filter((item): item is { type: "text"; text: string } =>
        typeof item === "object" && item !== null &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string")
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join("\n");
    if (message) return message;
  }
  return fallback;
}

function renderStatBlock(data: StatBlock) {
  current = data;
  card.replaceChildren();
  const header = element("header", "stat-header");
  const name = element("h1", "", data.creature.name);
  name.id = "creature-name";
  header.append(name);
  const classification = [data.creature.size, data.creature.type].filter(Boolean).join(" ") + (data.creature.alignment ? `, ${data.creature.alignment}` : "");
  if (classification) header.append(element("p", "classification", classification));
  const badges = element("div", "badges");
  if (data.creature.edition) badges.append(badge(data.creature.edition));
  if (data.creature.legacy) badges.append(badge("Legacy"));
  data.creature.tags.forEach((tag) => badges.append(badge(tag)));
  if (badges.childElementCount) header.append(badges);
  card.append(header);

  const attributes = element("div", "attributes");
  for (const attribute of data.attributes) {
    const row = element("div", "attribute");
    row.append(element("strong", "", `${attribute.label}. `), document.createTextNode(attribute.value));
    attributes.append(row);
  }
  card.append(attributes);

  if (data.abilities.length) {
    const table = element("table", "abilities");
    const head = element("thead");
    const headRow = element("tr");
    data.abilities.forEach((ability) => headRow.append(element("th", "", ability.name)));
    head.append(headRow);
    const body = element("tbody");
    const bodyRow = element("tr");
    data.abilities.forEach((ability) => bodyRow.append(element("td", "", [ability.score, ability.modifier ? `(${ability.modifier})` : null, ability.save ? `save ${ability.save}` : null].filter((part) => part !== null).join(" "))));
    body.append(bodyRow);
    table.append(head, body);
    card.append(table);
  }

  for (const sectionData of data.sections) {
    const section = element("section", "section");
    section.dataset.kind = sectionData.kind;
    section.append(element("h2", "", sectionData.title));
    for (const entryData of sectionData.entries) {
      const entry = element("p", "entry");
      if (entryData.name) entry.append(element("span", "entry-name", `${entryData.name}. `));
      const remainder = entryData.name
        ? entryData.text.replace(new RegExp(`^${entryData.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.:]?\\s*`, "i"), "")
        : entryData.text;
      entry.append(document.createTextNode(remainder));
      section.append(entry);
    }
    card.append(section);
  }
  if (data.creature.source) card.append(element("footer", "source-line", `Source: ${data.creature.source}`));
  title.textContent = data.creature.name;
  status.hidden = true;
  candidateList.hidden = true;
  card.hidden = false;
  applyZoom();
  window.requestAnimationFrame(updateImageExportAvailability);
}

async function loadCandidate(candidate: Candidate) {
  const key = `${candidate.id}\0${candidate.url}`;
  if (current?.creature.id === candidate.id && current.creature.url === candidate.url) return;
  if (loadingCandidateKey === key) return;
  loadingCandidateKey = key;
  setStatus(`Loading ${candidate.name}…`);
  try {
    const result = await app.callServerTool({
      name: "read_stat_block_for_app",
      arguments: { creature_id: candidate.id, creature_url: candidate.url },
    });
    if (result.isError) throw new Error(toolResultError(result, "The stat-block reader returned an unspecified error."));
    if (!result.structuredContent) throw new Error("The stat-block reader returned no structured data.");
    renderStatBlock(result.structuredContent as StatBlock);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The stat block could not be loaded.";
    setStatus(`Could not load ${candidate.name} (creature ${candidate.id}): ${detail}`, true);
  } finally {
    if (loadingCandidateKey === key) loadingCandidateKey = null;
  }
}

function appPrivateStatBlock(result: { _meta?: unknown }, candidate: Candidate): StatBlock | null {
  if (!result._meta || typeof result._meta !== "object") return null;
  const value = (result._meta as { statBlock?: unknown }).statBlock;
  if (!value || typeof value !== "object") return null;
  const block = value as Partial<StatBlock>;
  return block.kind === "stat_block" && block.creature?.id === candidate.id && block.creature.url === candidate.url
    ? block as StatBlock
    : null;
}

function renderCandidates(resolution: Extract<Resolution, { kind: "candidates" }>) {
  status.hidden = true;
  card.hidden = true;
  candidateList.replaceChildren(element("h2", "", `Choose a stat block for “${resolution.query}”`));
  for (const candidate of resolution.candidates) {
    const row = element("div", "candidate");
    const info = element("div");
    info.append(element("strong", "", candidate.name));
    const details = [candidate.source, candidate.edition, candidate.legacy ? "Legacy" : null, candidate.challengeRating ? `CR ${candidate.challengeRating}` : null].filter(Boolean).join(" · ");
    info.append(element("p", "", details));
    const choose = element("button", "", "View");
    choose.type = "button";
    choose.addEventListener("click", () => void loadCandidate(candidate));
    row.append(info, choose);
    candidateList.append(row);
  }
  candidateList.hidden = false;
}

function applyZoom() {
  card.style.transform = `scale(${zoom})`;
  card.style.marginBottom = card.hidden ? "0" : `${Math.max(0, card.offsetHeight * (zoom - 1))}px`;
  document.querySelector<HTMLOutputElement>("#zoom-level")!.value = `${Math.round(zoom * 100)}%`;
}

function toast(message: string) {
  const node = element("div", "toast", message);
  document.body.append(node);
  window.setTimeout(() => node.remove(), 2200);
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = element("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-10000px";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard unavailable");
  }
  toast("Copied");
}

function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "stat-block"; }

function makeExportPanels(): HTMLElement[] {
  if (!current) return [];
  const full = card.cloneNode(true) as HTMLElement;
  full.removeAttribute("id");
  full.hidden = false;
  full.classList.add("export-card");
  exportStage.replaceChildren(full);
  if (full.scrollHeight <= 12_000) return [full];

  const header = full.querySelector(".stat-header")!;
  const attributes = full.querySelector(".attributes")!;
  const abilities = full.querySelector(".abilities");
  const sections = Array.from(full.querySelectorAll<HTMLElement>(".section"));
  const footer = full.querySelector(".source-line");
  exportStage.replaceChildren();
  const panels: HTMLElement[] = [];
  const newPanel = (continuation: boolean) => {
    const panel = element("article", "stat-block export-card");
    panel.append(header.cloneNode(true), attributes.cloneNode(true));
    if (abilities) panel.append(abilities.cloneNode(true));
    if (continuation) panel.append(element("div", "continuation", `${current!.creature.name} — continued`));
    exportStage.append(panel);
    panels.push(panel);
    return panel;
  };
  let panel = newPanel(false);
  for (const section of sections) {
    panel.append(section.cloneNode(true));
    if (panel.scrollHeight > 12_000 && panel.querySelectorAll(".section").length > 1) {
      panel.lastElementChild?.remove();
      panel = newPanel(true);
      panel.append(section.cloneNode(true));
    }
  }
  if (footer) panel.append(footer.cloneNode(true));
  return panels;
}

function updateImageExportAvailability() {
  const copyImage = document.querySelector<HTMLButtonElement>("#copy-image")!;
  if (!current) {
    copyImage.disabled = true;
    return;
  }
  const panels = makeExportPanels();
  copyImage.disabled = panels.length !== 1;
  copyImage.title = panels.length === 1 ? "Copy image" : "Multi-panel blocks must be downloaded";
  exportStage.replaceChildren();
}

async function renderPngs(): Promise<Array<{ filename: string; blob: Blob; base64: string }>> {
  if (!current) throw new Error("No stat block is loaded.");
  const panels = makeExportPanels();
  const results = [];
  try {
    for (let index = 0; index < panels.length; index += 1) {
      const canvas = await html2canvas(panels[index], { backgroundColor: "#f4ead0", scale: 2, logging: false, useCORS: false });
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG generation failed.")), "image/png"));
      const base64 = (canvas.toDataURL("image/png").split(",", 2)[1] ?? "");
      const suffix = panels.length > 1 ? `-${index + 1}` : "";
      results.push({ filename: `${slug(current.creature.name)}-stat-block${suffix}.png`, blob, base64 });
    }
  } finally {
    exportStage.replaceChildren();
  }
  return results;
}

function downloadLocally(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = element("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

document.querySelector("#zoom-out")!.addEventListener("click", () => { zoom = Math.max(.6, zoom - .1); applyZoom(); });
document.querySelector("#zoom-in")!.addEventListener("click", () => { zoom = Math.min(1.6, zoom + .1); applyZoom(); });
document.querySelector("#copy-text")!.addEventListener("click", () => current && void writeClipboardText(current.markdown).catch(() => toast("Clipboard unavailable")));
document.querySelector("#copy-json")!.addEventListener("click", () => current && void writeClipboardText(JSON.stringify(current, null, 2)).catch(() => toast("Clipboard unavailable")));
document.querySelector("#open-source")!.addEventListener("click", () => {
  if (!current) return;
  if (app.getHostCapabilities()?.openLinks) void app.openLink({ url: current.creature.url });
  else window.open(current.creature.url, "_blank", "noopener,noreferrer");
});
document.querySelector("#fullscreen")!.addEventListener("click", () => {
  shell.classList.toggle("fullscreen");
  void app.requestDisplayMode({ mode: shell.classList.contains("fullscreen") ? "fullscreen" : "inline" }).catch(() => undefined);
});
document.querySelector("#copy-image")!.addEventListener("click", async () => {
  try {
    const pngs = await renderPngs();
    if (pngs.length !== 1) return;
    if (!("ClipboardItem" in window)) throw new Error("Image clipboard unavailable.");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngs[0].blob })]);
    toast("Image copied");
  } catch (error) { toast(error instanceof Error ? error.message : "Image copy failed"); }
});
document.querySelector("#download-png")!.addEventListener("click", async () => {
  try {
    const pngs = await renderPngs();
    if (app.getHostCapabilities()?.downloadFile) {
      const result = await app.downloadFile({ contents: pngs.map((png) => ({
        type: "resource" as const,
        resource: { uri: `file:///${png.filename}`, mimeType: "image/png", blob: png.base64 },
      })) });
      toast(result.isError ? "Download cancelled" : "Download ready");
    } else {
      pngs.forEach((png) => downloadLocally(png.filename, png.blob));
      toast("Download ready");
    }
  } catch (error) { toast(error instanceof Error ? error.message : "PNG export failed"); }
});

app.ontoolresult = (result) => {
  if (result.isError || !result.structuredContent) { setStatus("The stat block viewer could not be opened.", true); return; }
  const resolution = result.structuredContent as unknown as Resolution;
  if (resolution.kind === "resolved") {
    const preloaded = appPrivateStatBlock(result, resolution.candidate);
    if (preloaded) renderStatBlock(preloaded);
    else void loadCandidate(resolution.candidate);
  }
  else if (resolution.kind === "candidates") renderCandidates(resolution);
  else setStatus(`No stat block was found for “${resolution.query}”.`, true);
};

void app.connect().catch((error) => {
  setStatus(error instanceof Error ? error.message : "The stat block viewer could not connect to its host.", true);
});
