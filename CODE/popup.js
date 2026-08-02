const scanBtn = document.getElementById("scanBtn");
const scanBtnLabel = document.getElementById("scanBtnLabel");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const statusText = document.getElementById("statusText");
const summaryBox = document.getElementById("summary");
const errorBox = document.getElementById("errorBox");
const pageInfo = document.getElementById("pageInfo");
function getSelectedFormat() {
  const checked = document.querySelector('input[name="outputFormat"]:checked');
  return checked ? checked.value : "pdf";
}

function setProgress(pct, text) {
  progressWrap.classList.remove("hidden");
  progressFill.style.width = `${Math.max(4, Math.min(100, pct))}%`;
  if (text) statusText.textContent = text;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function sanitizeFilename(name) {
  return (name || "cdgen-report")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "cdgen-report";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download(
    { url, filename, saveAs: false },
    () => {
      // Revoke a bit later so the download has time to start reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  );
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

scanBtn.addEventListener("click", async () => {
  clearError();
  summaryBox.classList.add("hidden");
  scanBtn.disabled = true;
  scanBtnLabel.textContent = "Scanning…";
  setProgress(6, "Locating active tab…");

  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) throw new Error("Could not find the active tab.");
    if (!/^https?:/.test(tab.url || "")) {
      throw new Error("CDGen can only scan regular web pages (http/https), not this type of tab.");
    }

    setProgress(15, "Scanning page content…");
    const [{ result: scanResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: cdgenScanPage,
    });

    if (!scanResult || !scanResult.sections || scanResult.sections.length === 0) {
      throw new Error("No content sections were found on this page.");
    }

    pageInfo.textContent = `${scanResult.sections.length} section(s) found on: ${scanResult.meta.title || scanResult.meta.url}`;

    const format = getSelectedFormat(); // "pdf" or "docx"

    setProgress(25, "Fetching image thumbnails…");
    const imageCache = await CDGenDocBuilders.preloadImages(scanResult, true, (done, total) => {
      if (total > 0) {
        setProgress(25 + Math.round((done / total) * 30), `Fetching image thumbnails… (${done}/${total})`);
      }
    });

    const buildOpts = { imageCache, includeLinks: true };

    let sectionsDone = 0;
    const totalSections = scanResult.sections.length;
    const base = sanitizeFilename(scanResult.meta.title);
    let blob;

    if (format === "pdf") {
      setProgress(60, "Generating PDF document…");
      blob = await CDGenDocBuilders.buildPdf(scanResult, buildOpts, () => {
        sectionsDone += 1;
        setProgress(60 + Math.round((sectionsDone / totalSections) * 35), "Generating PDF document…");
      });
      downloadBlob(blob, `CDGen/${base}.pdf`);
    } else {
      setProgress(60, "Generating Word document…");
      blob = await CDGenDocBuilders.buildDocx(scanResult, buildOpts, () => {
        sectionsDone += 1;
        setProgress(60 + Math.round((sectionsDone / totalSections) * 35), "Generating Word document…");
      });
      downloadBlob(blob, `CDGen/${base}.docx`);
    }

    setProgress(100, "Done!");

    const imagesEmbedded = Array.from(imageCache.values()).filter(Boolean).length;
    const componentsFound = scanResult.sections.filter((s) => s.componentName).length;
    const highlightsFound = scanResult.sections.reduce((sum, s) => sum + (s.highlights ? s.highlights.length : 0), 0);
    summaryBox.innerHTML = `
      <h3>Scan complete <span class="ok">✓</span></h3>
      <ul>
        <li><strong>${scanResult.sections.length}</strong> section(s) extracted</li>
        <li><strong>${componentsFound}</strong> component/block name(s) detected</li>
        <li><strong>${highlightsFound}</strong> highlight(s) collected</li>
        <li><strong>${imagesEmbedded}</strong> image thumbnail(s) embedded</li>
        <li>SEO data captured (title, description, OG/Twitter tags, canonical, etc.)</li>
        <li>${format.toUpperCase()} file saved to your Downloads &rarr; <strong>CDGen</strong> folder</li>
      </ul>
    `;
    summaryBox.classList.remove("hidden");
  } catch (err) {
    console.error("CDGen error:", err);
    showError(err && err.message ? err.message : "Something went wrong while generating the documents.");
    setProgress(0, "");
    progressWrap.classList.add("hidden");
  } finally {
    scanBtn.disabled = false;
    scanBtnLabel.textContent = "Scan This Page";
  }
});
