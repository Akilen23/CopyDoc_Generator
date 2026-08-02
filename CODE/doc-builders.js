/* global jspdf, docx */

const CDGenDocBuilders = (() => {
  const MAX_IMAGES_PER_SECTION = 8;
  const THUMB_MAX_WIDTH = 260; // px, keeps generated files reasonably small

  const COLOR = {
    accent: [79, 70, 229],
    accentHex: "4F46E5",
    title: [30, 41, 82],
    titleHex: "1E2952",
    labelText: [90, 90, 100],
    labelTextHex: "5A5A64",
    labelFill: [246, 247, 251],
    labelFillHex: "F6F7FB",
    valueText: [25, 25, 32],
    valueTextHex: "191920",
    border: [223, 224, 232],
    borderHex: "DFE0E8",
    muted: [130, 130, 140],
    mutedHex: "82828C",

    // Per-group accent palette. Each section is rendered as a set of
    // sub-blocks (Overview / Details / Highlights / Media / Actions),
    // and each sub-block gets its own header color + fill so the reader
    // can tell at a glance which kind of content they're looking at.
    overviewText: [90, 90, 100],
    overviewTextHex: "5A5A64",

    detailsAccent: [79, 70, 229],
    detailsAccentHex: "4F46E5",
    detailsFill: [248, 249, 253],
    detailsFillHex: "F8F9FD",

    highlightAccent: [217, 119, 6],
    highlightAccentHex: "D97706",
    highlightFill: [255, 247, 230],
    highlightFillHex: "FFF7E6",
    highlightBorder: [245, 209, 133],
    highlightBorderHex: "F5D185",
    strongChip: [79, 70, 229],
    strongChipHex: "4F46E5",
    emChip: [13, 148, 136],
    emChipHex: "0D9488",
    markChip: [217, 119, 6],
    markChipHex: "D97706",

    mediaAccent: [37, 99, 235],
    mediaAccentHex: "2563EB",
    mediaFill: [247, 249, 255],
    mediaFillHex: "F7F9FF",
    mediaBorder: [214, 224, 250],
    mediaBorderHex: "D6E0FA",

    actionsAccent: [22, 128, 92],
    actionsAccentHex: "16805C",
    actionsFill: [240, 250, 246],
    actionsFillHex: "F0FAF6",
    actionsBorder: [178, 226, 205],
    actionsBorderHex: "B2E2CD",

    designAccent: [124, 58, 237],
    designAccentHex: "7C3AED",
    designFill: [248, 245, 255],
    designFillHex: "F8F5FF",
    designBorder: [216, 197, 247],
    designBorderHex: "D8C5F7",
    depthYes: [124, 58, 237],
    depthYesHex: "7C3AED",
    depthNo: [130, 130, 140],
    depthNoHex: "82828C",
  };

  const KIND_LABEL = { strong: "BOLD", b: "BOLD", em: "ITALIC", i: "ITALIC", mark: "MARK" };

  function chipColorFor(kind) {
    if (kind === "em" || kind === "i") return { fill: COLOR.emChip, fillHex: COLOR.emChipHex };
    if (kind === "mark") return { fill: COLOR.markChip, fillHex: COLOR.markChipHex };
    return { fill: COLOR.strongChip, fillHex: COLOR.strongChipHex };
  }

  async function fetchAndResizeImage(url, onProgress) {
    try {
      const res = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) return null;

      const bitmap = await createImageBitmap(blob).catch(() => null);
      if (!bitmap) return null;

      const scale = Math.min(1, THUMB_MAX_WIDTH / bitmap.width);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      const arrBuf = await (await fetch(dataUrl)).arrayBuffer();

      return { dataUrl, width: w, height: h, bytes: new Uint8Array(arrBuf) };
    } catch (e) {
      return null;
    } finally {
      if (onProgress) onProgress();
    }
  }

  function imageEntriesOf(section) {
    return section.entries.filter((e) => e.type === "image").slice(0, MAX_IMAGES_PER_SECTION);
  }

  async function preloadImages(scanResult, embedImages, onProgress) {
    const cache = new Map();
    if (!embedImages) return cache;

    const jobs = [];
    scanResult.sections.forEach((section) => {
      imageEntriesOf(section).forEach((img) => {
        if (!cache.has(img.src)) {
          cache.set(img.src, null);
          jobs.push(img.src);
        }
      });
    });

    let done = 0;
    const total = jobs.length;
    for (const src of jobs) {
      const result = await fetchAndResizeImage(src, () => {
        done += 1;
        if (onProgress) onProgress(done, total);
      });
      cache.set(src, result);
    }
    return cache;
  }

  function fontLabel(font) {
    if (!font) return "";
    const parts = [];
    if (font.family) parts.push(font.family);
    if (font.size) parts.push(font.size);
    if (font.weight) parts.push(font.weight);
    if (font.italic) parts.push(font.italic);
    return parts.join("  \u00b7  ");
  }

  function titleForSection(section) {
    // Prefer the detected semantic section name (Hero, Testimonial, Card
    // Section, Footer, etc.); fall back to a specifically detected
    // WordPress block / React component name, then the structural category.
    return section.sectionName || section.componentName || section.category || "Content Card";
  }

  // Splits a section's fields into named groups so each can be rendered as
  // its own styled sub-block: Overview (identity), Details (body copy),
  // Highlights (bold/italic/mark spans), Media (images), Actions (buttons +
  // links). A group is omitted entirely when the section has nothing for it.
  function groupsForSection(section, opts) {
    const groups = [];

    const overviewRows = [
      { label: "Section Name", value: section.sectionName || "Content Section" },
      { label: "Section Type", value: section.category || "Not detected" },
      { label: "Component Name", value: section.componentName || "Not detected" },
    ];
    const headingEntry = section.entries.find((e) => e.type === "heading");
    if (headingEntry) {
      overviewRows.push({ label: "Heading Text", value: headingEntry.text });
      overviewRows.push({ label: "Heading Level", value: `H${headingEntry.level}` });
    }
    groups.push({ key: "overview", title: "Overview", rows: overviewRows });

    if (section.design) {
      groups.push({ key: "design", title: "Design & Effects", design: section.design });
    }

    const textEntries = section.entries.filter((e) => e.type === "text");
    if (textEntries.length) {
      groups.push({ key: "details", title: "Details", text: textEntries.map((e) => e.text).join("\n\n") });
    }

    const highlights = section.highlights || [];
    if (highlights.length) {
      groups.push({ key: "highlights", title: "Highlights", items: highlights });
    }

    const imageEntries = section.entries.filter((e) => e.type === "image").slice(0, MAX_IMAGES_PER_SECTION);
    if (imageEntries.length) {
      groups.push({ key: "media", title: "Media", images: imageEntries });
    }

    const buttonEntries = section.entries.filter((e) => e.type === "button");
    const linkEntries = opts.includeLinks ? section.entries.filter((e) => e.type === "link") : [];
    if (buttonEntries.length || linkEntries.length) {
      groups.push({ key: "actions", title: "Actions", buttons: buttonEntries, links: linkEntries });
    }

    return groups;
  }

  // Single SEO Metadata box for the whole page, laid out as Property/Value
  // pairs the same way social/SEO fields are documented in CMS content specs.
  function seoRows(seo) {
    if (!seo) return [];
    return [
      { label: "Social Share URL (Twitter)", value: seo.ogUrl || seo.canonical || "\u2014" },
      { label: "Social Share Title (Twitter)", value: seo.twitterTitle || seo.metaTitle || "\u2014" },
      { label: "Social Share Description (Twitter)", value: seo.twitterDescription || seo.metaDescription || "\u2014" },
      { label: "Open Graph URL", value: seo.ogUrl || "\u2014" },
      { label: "Open Graph Title", value: seo.ogTitle || "\u2014" },
      { label: "Open Graph Description", value: seo.ogDescription || "\u2014" },
      { label: "Canonical URL", value: seo.canonical || "\u2014" },
      { label: "Meta Description", value: seo.metaDescription || "\u2014" },
      { label: "Meta Keywords", value: seo.metaKeywords || "\u2014" },
      { label: "Robots", value: seo.robots || "\u2014" },
      { label: "Viewport", value: seo.viewport || "\u2014" },
      { label: "Open Graph Image", value: seo.ogImage || "\u2014" },
      { label: "Open Graph Type", value: seo.ogType || "\u2014" },
      { label: "Twitter Card Type", value: seo.twitterCard || "\u2014" },
      { label: "Twitter Image", value: seo.twitterImage || "\u2014" },
      { label: "H1 Count on Page", value: seo.h1Count || "0" },
    ];
  }

  // ---------------------------------------------------------------------
  // PDF (jsPDF)
  // ---------------------------------------------------------------------

  async function buildPdf(scanResult, opts, onProgress) {
    const { jsPDF } = jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 44;
    const maxW = pageW - margin * 2;
    const labelW = 128;
    const valueW = maxW - labelW;
    const cellPadX = 8;
    const lineH = 12.5;
    const rowPadY = 7;
    let y = margin;

    function ensureSpace(needed) {
      if (y + needed > pageH - margin) {
        doc.addPage();
        y = margin;
      }
    }

    // --- plain label/value rows (used by Overview, Page Info, SEO Metadata) ---

    function measureRowHeight(row) {
      if (row.value && typeof row.value === "object" && row.value.image) {
        const cached = opts.imageCache.get(row.value.image.src);
        if (cached) {
          return Math.max(90 + rowPadY * 2, lineH + rowPadY * 2);
        }
        return lineH + rowPadY * 2;
      }
      const valLines = doc.splitTextToSize(String(row.value ?? "\u2014") || "\u2014", valueW - cellPadX * 2);
      const labLines = doc.splitTextToSize(String(row.label), labelW - cellPadX * 2);
      const n = Math.max(valLines.length, labLines.length, 1);
      return n * lineH + rowPadY * 2;
    }

    function drawRow(row, x, rowY, h) {
      doc.setFillColor(...COLOR.labelFill);
      doc.rect(x, rowY, labelW, h, "F");
      doc.setFillColor(255, 255, 255);
      doc.rect(x + labelW, rowY, valueW, h, "F");
      doc.setDrawColor(...COLOR.border);
      doc.setLineWidth(0.6);
      doc.rect(x, rowY, labelW, h);
      doc.rect(x + labelW, rowY, valueW, h);
      doc.setFillColor(...COLOR.accent);
      doc.rect(x, rowY, 2.6, h, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...COLOR.labelText);
      const labLines = doc.splitTextToSize(String(row.label), labelW - cellPadX * 2);
      labLines.forEach((l, i) => doc.text(l, x + cellPadX, rowY + rowPadY + 8 + i * lineH));

      if (row.value && typeof row.value === "object" && row.value.image) {
        const cached = opts.imageCache.get(row.value.image.src);
        if (cached) {
          const ratio = cached.width / cached.height;
          const thumbH = 90;
          const thumbW = Math.min(150, thumbH * ratio);
          try {
            doc.addImage(cached.dataUrl, "JPEG", x + labelW + cellPadX, rowY + rowPadY, thumbW, thumbH);
          } catch (e) {
            /* skip broken image silently */
          }
        } else {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9.5);
          doc.setTextColor(...COLOR.muted);
          doc.text("(thumbnail not embedded)", x + labelW + cellPadX, rowY + rowPadY + 8);
        }
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...COLOR.valueText);
        const valLines = doc.splitTextToSize(String(row.value ?? "\u2014") || "\u2014", valueW - cellPadX * 2);
        valLines.forEach((l, i) => doc.text(l, x + labelW + cellPadX, rowY + rowPadY + 8 + i * lineH));
      }
    }

    function drawRowTable(rows) {
      rows.forEach((row) => {
        const h = measureRowHeight(row);
        ensureSpace(h);
        drawRow(row, margin, y, h);
        y += h;
      });
    }

    // --- shared sub-block chrome: a small caps header + tinted card body ---

    function subBlockHeader(label, accentRGB) {
      ensureSpace(20);
      y += 10;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...accentRGB);
      doc.text(label.toUpperCase(), margin, y);
      doc.setDrawColor(...accentRGB);
      doc.setLineWidth(1.1);
      const tw = doc.getTextWidth(label.toUpperCase());
      doc.line(margin, y + 3, margin + tw, y + 3);
      y += 12;
    }

    // --- Details sub-block: tinted card, left accent bar, wrapped paragraph text ---

    function drawDetailsGroup(group) {
      subBlockHeader("Details", COLOR.detailsAccent);
      const paraW = maxW - 14;
      const paragraphs = group.text.split("\n\n");
      const allLines = [];
      paragraphs.forEach((p, i) => {
        if (i > 0) allLines.push("");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        allLines.push(...doc.splitTextToSize(p, paraW - cellPadX * 2));
      });
      const h = allLines.length * lineH + rowPadY * 2;
      ensureSpace(h);
      doc.setFillColor(...COLOR.detailsFill);
      doc.rect(margin, y, paraW, h, "F");
      doc.setFillColor(...COLOR.detailsAccent);
      doc.rect(margin, y, 3, h, "F");
      doc.setTextColor(...COLOR.valueText);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      allLines.forEach((l, i) => {
        if (l) doc.text(l, margin + cellPadX + 3, y + rowPadY + 8 + i * lineH);
      });
      y += h + 6;
    }

    // --- Highlights sub-block: one chip per bold/italic/mark span, kind-colored ---

    function drawHighlightsGroup(group) {
      subBlockHeader("Highlights", COLOR.highlightAccent);
      const cardW = maxW;

      // Measure each chip + wrapped text first so we know the card height
      // before drawing anything (avoids drawing over a page break).
      const rowsMeta = group.items.map((h) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.7);
        const kindLabel = KIND_LABEL[h.kind] || h.kind.toUpperCase();
        const chipW = doc.getTextWidth(kindLabel) + 12;
        const textLines = doc.splitTextToSize(h.text, cardW - chipW - cellPadX * 3 - 8);
        const rowH = Math.max(textLines.length * lineH, 14) + 8;
        return { kindLabel, chipW, textLines, kind: h.kind, rowH };
      });
      const totalH = rowsMeta.reduce((sum, r) => sum + r.rowH, 0) + rowPadY * 2;
      ensureSpace(Math.min(totalH, pageH - margin * 2));

      const blockStartY = y;
      doc.setFillColor(...COLOR.highlightFill);
      doc.roundedRect(margin, blockStartY, cardW, totalH, 4, 4, "F");
      doc.setDrawColor(...COLOR.highlightBorder);
      doc.setLineWidth(0.8);
      doc.roundedRect(margin, blockStartY, cardW, totalH, 4, 4);

      let rowY = blockStartY + rowPadY;
      rowsMeta.forEach((r) => {
        const chip = chipColorFor(r.kind);
        doc.setFillColor(...chip.fill);
        doc.roundedRect(margin + cellPadX, rowY, r.chipW, 13, 3, 3, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.6);
        doc.setTextColor(255, 255, 255);
        doc.text(r.kindLabel, margin + cellPadX + 6, rowY + 9);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.7);
        doc.setTextColor(...COLOR.valueText);
        r.textLines.forEach((l, i) => {
          doc.text(l, margin + cellPadX + r.chipW + 10, rowY + 9 + i * lineH);
        });
        rowY += r.rowH;
      });

      y = blockStartY + totalH + 6;
    }

    // --- Design & Effects sub-block: background, effects list, depth-effect badge ---

    function drawDesignGroup(group) {
      subBlockHeader("Design & Effects", COLOR.designAccent);
      const cardW = maxW;
      const innerW = cardW - cellPadX * 2 - 10;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.7);
      const bgLines = doc.splitTextToSize(`Background: ${group.design.background}`, innerW);
      const effectLines = [];
      group.design.effects.forEach((e) => {
        effectLines.push(...doc.splitTextToSize(`\u2022 ${e}`, innerW));
      });
      const depthLabel = group.design.depthEffect ? "Depth Effect: Yes" : "Depth Effect: No";

      const h = (bgLines.length + effectLines.length + 1) * lineH + rowPadY * 2 + 6;
      ensureSpace(h);

      const startY = y;
      doc.setFillColor(...COLOR.designFill);
      doc.roundedRect(margin, startY, cardW, h, 4, 4, "F");
      doc.setDrawColor(...COLOR.designBorder);
      doc.setLineWidth(0.8);
      doc.roundedRect(margin, startY, cardW, h, 4, 4);

      let iy = startY + rowPadY;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.7);
      doc.setTextColor(...COLOR.valueText);
      bgLines.forEach((l, i) => doc.text(l, margin + cellPadX + 3, iy + 8 + i * lineH));
      iy += bgLines.length * lineH;

      effectLines.forEach((l, i) => doc.text(l, margin + cellPadX + 3, iy + 8 + i * lineH));
      iy += effectLines.length * lineH + 4;

      const depthColor = group.design.depthEffect ? COLOR.depthYes : COLOR.depthNo;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.3);
      doc.setTextColor(...depthColor);
      doc.text(depthLabel, margin + cellPadX + 3, iy + 8);

      y = startY + h + 6;
    }

    // --- Media sub-block: one bordered card per image (thumbnail + alt + link) ---

    function drawMediaGroup(group) {
      subBlockHeader("Media", COLOR.mediaAccent);
      group.images.forEach((img) => {
        const cached = opts.imageCache.get(img.src);
        const thumbH = cached ? 90 : 0;
        const altLines = doc.splitTextToSize(`Alt Text: ${img.alt || "Not provided"}`, maxW - 20);
        const linkLines = doc.splitTextToSize(`Image link: ${img.src}`, maxW - 20);
        const textH = (altLines.length + linkLines.length) * lineH;
        const cardH = Math.max(thumbH, 0) + textH + rowPadY * 2 + (thumbH ? 8 : 0);
        ensureSpace(cardH + 6);

        doc.setFillColor(...COLOR.mediaFill);
        doc.roundedRect(margin, y, maxW, cardH, 4, 4, "F");
        doc.setDrawColor(...COLOR.mediaBorder);
        doc.roundedRect(margin, y, maxW, cardH, 4, 4);

        let iy = y + rowPadY;
        if (cached) {
          const ratio = cached.width / cached.height;
          const thumbW = Math.min(160, thumbH * ratio);
          try {
            doc.addImage(cached.dataUrl, "JPEG", margin + 10, iy, thumbW, thumbH);
          } catch (e) { /* skip */ }
          iy += thumbH + 8;
        } else {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9.5);
          doc.setTextColor(...COLOR.muted);
          doc.text("(thumbnail not embedded)", margin + 10, iy + 8);
          iy += 16;
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(...COLOR.valueText);
        altLines.forEach((l, i) => doc.text(l, margin + 10, iy + 8 + i * lineH));
        iy += altLines.length * lineH;
        doc.setTextColor(...COLOR.mediaAccent);
        linkLines.forEach((l, i) => doc.text(l, margin + 10, iy + 8 + i * lineH));

        y += cardH + 8;
      });
    }

    // --- Actions sub-block: pill-style rows for buttons, underlined rows for links ---

    function drawActionsGroup(group) {
      subBlockHeader("Actions", COLOR.actionsAccent);

      group.buttons.forEach((btn) => {
        const labelLines = doc.splitTextToSize(btn.text || "(no label)", maxW - 24);
        const metaText = `Type: ${btn.buttonType || "button"}   \u00b7   Aria Label: ${btn.ariaLabel || btn.text || "\u2014"}${btn.href ? `   \u00b7   Link: ${btn.href}` : ""}`;
        const metaLines = doc.splitTextToSize(metaText, maxW - 24);
        const h = (labelLines.length + metaLines.length) * lineH + rowPadY * 2;
        ensureSpace(h + 6);
        doc.setFillColor(...COLOR.actionsFill);
        doc.roundedRect(margin, y, maxW, h, 6, 6, "F");
        doc.setDrawColor(...COLOR.actionsBorder);
        doc.roundedRect(margin, y, maxW, h, 6, 6);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...COLOR.actionsAccent);
        labelLines.forEach((l, i) => doc.text(`\u25B8 ${l}`, margin + 12, y + rowPadY + 8 + i * lineH));
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.6);
        doc.setTextColor(...COLOR.muted);
        metaLines.forEach((l, i) => doc.text(l, margin + 12, y + rowPadY + 8 + labelLines.length * lineH + i * lineH));
        y += h + 6;
      });

      group.links.forEach((lnk) => {
        const labelLines = doc.splitTextToSize(lnk.text || "(no text)", maxW - 24);
        const metaText = `URL: ${lnk.href}   \u00b7   Aria Label: ${lnk.ariaLabel || lnk.text || "\u2014"}   \u00b7   Target: ${lnk.target || "_self"}`;
        const metaLines = doc.splitTextToSize(metaText, maxW - 24);
        const h = (labelLines.length + metaLines.length) * lineH + rowPadY * 2;
        ensureSpace(h + 6);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(margin, y, maxW, h, 4, 4, "F");
        doc.setDrawColor(...COLOR.actionsBorder);
        doc.setLineWidth(0.7);
        doc.roundedRect(margin, y, maxW, h, 4, 4);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...COLOR.mediaAccent);
        labelLines.forEach((l, i) => doc.text(l, margin + 12, y + rowPadY + 8 + i * lineH));
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.6);
        doc.setTextColor(...COLOR.muted);
        metaLines.forEach((l, i) => doc.text(l, margin + 12, y + rowPadY + 8 + labelLines.length * lineH + i * lineH));
        y += h + 6;
      });
    }

    function drawGroup(group) {
      if (group.key === "overview") {
        subBlockHeader("Overview", COLOR.overviewText);
        drawRowTable(group.rows);
        y += 4;
      } else if (group.key === "design") {
        drawDesignGroup(group);
      } else if (group.key === "details") {
        drawDetailsGroup(group);
      } else if (group.key === "highlights") {
        drawHighlightsGroup(group);
      } else if (group.key === "media") {
        drawMediaGroup(group);
      } else if (group.key === "actions") {
        drawActionsGroup(group);
      }
    }

    // Plain component box (used for SEO Metadata / Page Info, which stay as
    // simple label/value tables rather than grouped sub-blocks).
    function drawPlainComponent(title, rows) {
      ensureSpace(30);
      y += 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12.5);
      doc.setTextColor(...COLOR.title);
      const titleLines = doc.splitTextToSize(title, maxW);
      titleLines.forEach((l, i) => {
        if (i > 0) { ensureSpace(15); y += 15; }
        doc.text(l, margin, y);
      });
      y += 6;
      doc.setDrawColor(...COLOR.accent);
      doc.setLineWidth(1.6);
      doc.line(margin, y, pageW - margin, y);
      y += 10;
      drawRowTable(rows);
      y += 14;
    }

    // Section container: outer border box around the title + all its
    // grouped sub-blocks, so each section reads as one distinct unit.
    function drawSectionContainer(title, groups) {
      ensureSpace(34);
      const startPage = doc.internal.getNumberOfPages();
      const boxStartY = y + 4;
      y += 18;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...COLOR.title);
      const titleLines = doc.splitTextToSize(title, maxW - 16);
      titleLines.forEach((l, i) => {
        if (i > 0) { ensureSpace(16); y += 16; }
        doc.text(l, margin + 8, y);
      });
      y += 8;
      doc.setDrawColor(...COLOR.accent);
      doc.setLineWidth(2);
      doc.line(margin, y, pageW - margin, y);
      y += 4;

      groups.forEach((group) => drawGroup(group));

      const endPage = doc.internal.getNumberOfPages();
      // Frame the whole section (title + every sub-block) as one visible box,
      // so it reads as a single unit rather than a stack of separate cards.
      // Only draw it when the section rendered on a single page -- a box
      // can't meaningfully span a page break.
      if (endPage === startPage) {
        doc.setDrawColor(...COLOR.border);
        doc.setLineWidth(1);
        doc.roundedRect(margin - 6, boxStartY, maxW + 12, y - boxStartY + 4, 5, 5);
      }

      y += 14;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.setTextColor(...COLOR.title);
    const pageTitleLines = doc.splitTextToSize(scanResult.meta.title || "(untitled)", maxW);
    pageTitleLines.forEach((l) => {
      doc.text(l, margin, y);
      y += 22;
    });
    y += 2;

    const metaRows = [{ label: "URL", value: scanResult.meta.url }];
    if (scanResult.meta.description) metaRows.push({ label: "Meta Description", value: scanResult.meta.description });
    metaRows.push({ label: "Scanned At", value: new Date(scanResult.meta.scannedAt).toLocaleString() });
    metaRows.push({ label: "Total Sections", value: String(scanResult.sections.length) });

    if (scanResult.meta.seo) {
      drawPlainComponent("SEO Metadata", seoRows(scanResult.meta.seo));
    }

    drawPlainComponent("Page Info", metaRows);

    for (const section of scanResult.sections) {
      const groups = groupsForSection(section, opts);
      drawSectionContainer(titleForSection(section), groups);
      if (onProgress) onProgress();
    }

    return doc.output("blob");
  }

  // ---------------------------------------------------------------------
  // DOCX (docx.js)
  // ---------------------------------------------------------------------

  async function buildDocx(scanResult, opts, onProgress) {
    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
      Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, AlignmentType,
    } = docx;

    const children = [];

    const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: COLOR.borderHex };
    const accentBorder = { style: BorderStyle.SINGLE, size: 20, color: COLOR.accentHex };
    const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

    function labelCell(text) {
      return new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: COLOR.labelFillHex },
        borders: { top: cellBorder, bottom: cellBorder, right: cellBorder, left: accentBorder },
        margins: { top: 90, bottom: 90, left: 110, right: 90 },
        children: [
          new Paragraph({
            children: [new TextRun({ text, bold: true, color: COLOR.labelTextHex, size: 18 })],
          }),
        ],
      });
    }

    function valueCell(value) {
      let para;
      if (value && typeof value === "object" && value.image) {
        const cached = opts.imageCache.get(value.image.src);
        if (cached) {
          const ratio = cached.width / cached.height;
          const h = 90;
          const w = Math.round(h * ratio);
          para = new Paragraph({
            children: [new ImageRun({ type: "jpg", data: cached.bytes, transformation: { width: w, height: h } })],
          });
        } else {
          para = new Paragraph({
            children: [new TextRun({ text: "(thumbnail not embedded)", italics: true, color: COLOR.mutedHex, size: 18 })],
          });
        }
      } else {
        const text = String(value ?? "\u2014") || "\u2014";
        const lines = text.split("\n");
        const runs = [];
        lines.forEach((line, i) => {
          if (i > 0) runs.push(new TextRun({ break: 1 }));
          runs.push(new TextRun({ text: line, color: COLOR.valueTextHex, size: 20 }));
        });
        para = new Paragraph({ children: runs });
      }
      return new TableCell({
        width: { size: 70, type: WidthType.PERCENTAGE },
        borders: { top: cellBorder, bottom: cellBorder, right: cellBorder, left: cellBorder },
        margins: { top: 90, bottom: 90, left: 110, right: 90 },
        children: [para],
      });
    }

    function fieldTable(rows) {
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map((row) => new TableRow({ children: [labelCell(row.label), valueCell(row.value)] })),
      });
    }

    // Small caps sub-block header, colored per group type.
    function groupHeader(label, colorHex) {
      return new Paragraph({
        children: [new TextRun({ text: label.toUpperCase(), bold: true, color: colorHex, size: 17, characterSpacing: 12 })],
        spacing: { before: 200, after: 60 },
        border: { bottom: { color: colorHex, space: 2, style: BorderStyle.SINGLE, size: 8 } },
      });
    }

    // Details: single-cell "card" with a colored left border and shaded fill.
    function detailsBlock(group) {
      const paragraphs = group.text.split("\n\n").map(
        (p, i) => new Paragraph({
          children: [new TextRun({ text: p, color: COLOR.valueTextHex, size: 20 })],
          spacing: { after: i < group.text.split("\n\n").length - 1 ? 120 : 0 },
        })
      );
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 100, type: WidthType.PERCENTAGE },
                shading: { type: ShadingType.CLEAR, color: "auto", fill: COLOR.detailsFillHex },
                borders: { top: noBorder, bottom: noBorder, right: noBorder, left: { style: BorderStyle.SINGLE, size: 24, color: COLOR.detailsAccentHex } },
                margins: { top: 120, bottom: 120, left: 160, right: 120 },
                children: paragraphs,
              }),
            ],
          }),
        ],
      });
    }

    // Highlights: one shaded chip row per span, colored by kind (bold/italic/mark).
    function highlightsBlock(group) {
      const rows = group.items.map((h) => {
        const kindLabel = KIND_LABEL[h.kind] || h.kind.toUpperCase();
        const chip = chipColorFor(h.kind);
        const chipCell = new TableCell({
          width: { size: 16, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: "auto", fill: chip.fillHex },
          borders: { top: noBorder, bottom: noBorder, right: noBorder, left: noBorder },
          margins: { top: 60, bottom: 60, left: 90, right: 90 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: kindLabel, bold: true, color: "FFFFFF", size: 14 })],
          })],
        });
        const textCell = new TableCell({
          width: { size: 84, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: "auto", fill: COLOR.highlightFillHex },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.highlightBorderHex },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.highlightBorderHex },
            right: { style: BorderStyle.SINGLE, size: 4, color: COLOR.highlightBorderHex },
            left: noBorder,
          },
          margins: { top: 90, bottom: 90, left: 110, right: 90 },
          children: [new Paragraph({ children: [new TextRun({ text: h.text, color: COLOR.valueTextHex, size: 19 })] })],
        });
        return new TableRow({ children: [chipCell, textCell] });
      });
      return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
    }

    // Design & Effects: violet-tinted card with background description,
    // bulleted effects list, and a colored Depth Effect Yes/No badge.
    function designBlock(group) {
      const d = group.design;
      const parts = [
        new Paragraph({
          children: [
            new TextRun({ text: "Background: ", bold: true, color: COLOR.designAccentHex, size: 19 }),
            new TextRun({ text: d.background, color: COLOR.valueTextHex, size: 19 }),
          ],
          spacing: { after: 80 },
        }),
      ];
      d.effects.forEach((e) => {
        parts.push(new Paragraph({
          children: [new TextRun({ text: `\u2022 ${e}`, color: COLOR.valueTextHex, size: 19 })],
          spacing: { after: 20 },
        }));
      });
      const depthColorHex = d.depthEffect ? COLOR.depthYesHex : COLOR.depthNoHex;
      parts.push(new Paragraph({
        children: [new TextRun({ text: d.depthEffect ? "Depth Effect: Yes" : "Depth Effect: No", bold: true, color: depthColorHex, size: 19 })],
        spacing: { before: 80 },
      }));

      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 100, type: WidthType.PERCENTAGE },
                shading: { type: ShadingType.CLEAR, color: "auto", fill: COLOR.designFillHex },
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 6, color: COLOR.designBorderHex },
                  bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.designBorderHex },
                  left: { style: BorderStyle.SINGLE, size: 6, color: COLOR.designBorderHex },
                  right: { style: BorderStyle.SINGLE, size: 6, color: COLOR.designBorderHex },
                },
                margins: { top: 120, bottom: 120, left: 140, right: 140 },
                children: parts,
              }),
            ],
          }),
        ],
      });
    }

    // Media: one card per image with a bordered cell for the thumbnail and its metadata.
    function mediaBlock(group) {
      const rows = group.images.map((img) => {
        const cached = opts.imageCache.get(img.src);
        const parts = [];
        if (cached) {
          const ratio = cached.width / cached.height;
          const h = 100;
          const w = Math.round(h * ratio);
          parts.push(new Paragraph({
            children: [new ImageRun({ type: "jpg", data: cached.bytes, transformation: { width: w, height: h } })],
            spacing: { after: 100 },
          }));
        } else {
          parts.push(new Paragraph({
            children: [new TextRun({ text: "(thumbnail not embedded)", italics: true, color: COLOR.mutedHex, size: 18 })],
            spacing: { after: 100 },
          }));
        }
        parts.push(new Paragraph({
          children: [
            new TextRun({ text: "Alt Text: ", bold: true, color: COLOR.mediaAccentHex, size: 18 }),
            new TextRun({ text: img.alt || "Not provided", color: COLOR.valueTextHex, size: 18 }),
          ],
          spacing: { after: 40 },
        }));
        parts.push(new Paragraph({
          children: [
            new TextRun({ text: "Image link: ", bold: true, color: COLOR.mediaAccentHex, size: 18 }),
            new TextRun({ text: img.src, color: COLOR.valueTextHex, size: 18 }),
          ],
        }));
        return new TableRow({
          children: [
            new TableCell({
              width: { size: 100, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, color: "auto", fill: COLOR.mediaFillHex },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 6, color: COLOR.mediaBorderHex },
                bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.mediaBorderHex },
                left: { style: BorderStyle.SINGLE, size: 6, color: COLOR.mediaBorderHex },
                right: { style: BorderStyle.SINGLE, size: 6, color: COLOR.mediaBorderHex },
              },
              margins: { top: 120, bottom: 120, left: 140, right: 140 },
              children: parts,
            }),
          ],
        });
      });
      return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
    }

    // Actions: buttons get a filled pill-style card, links get an outlined card.
    function actionsBlock(group) {
      const rows = [];
      group.buttons.forEach((btn) => {
        const metaBits = [`Type: ${btn.buttonType || "button"}`, `Aria Label: ${btn.ariaLabel || btn.text || "\u2014"}`];
        if (btn.href) metaBits.push(`Link: ${btn.href}`);
        rows.push(new TableRow({
          children: [new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: COLOR.actionsFillHex },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 6, color: COLOR.actionsBorderHex },
              bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.actionsBorderHex },
              left: { style: BorderStyle.SINGLE, size: 6, color: COLOR.actionsBorderHex },
              right: { style: BorderStyle.SINGLE, size: 6, color: COLOR.actionsBorderHex },
            },
            margins: { top: 100, bottom: 100, left: 140, right: 120 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: `\u25B8 ${btn.text || "(no label)"}`, bold: true, color: COLOR.actionsAccentHex, size: 20 })],
                spacing: { after: 40 },
              }),
              new Paragraph({ children: [new TextRun({ text: metaBits.join("   \u00b7   "), color: COLOR.mutedHex, size: 16 })] }),
            ],
          })],
        }));
      });
      group.links.forEach((lnk) => {
        const metaBits = [`URL: ${lnk.href}`, `Aria Label: ${lnk.ariaLabel || lnk.text || "\u2014"}`, `Target: ${lnk.target || "_self"}`];
        rows.push(new TableRow({
          children: [new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: "FFFFFF" },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.actionsBorderHex },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.actionsBorderHex },
              left: { style: BorderStyle.SINGLE, size: 4, color: COLOR.actionsBorderHex },
              right: { style: BorderStyle.SINGLE, size: 4, color: COLOR.actionsBorderHex },
            },
            margins: { top: 100, bottom: 100, left: 140, right: 120 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: lnk.text || "(no text)", bold: true, color: COLOR.mediaAccentHex, size: 20 })],
                spacing: { after: 40 },
              }),
              new Paragraph({ children: [new TextRun({ text: metaBits.join("   \u00b7   "), color: COLOR.mutedHex, size: 16 })] }),
            ],
          })],
        }));
      });
      return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
    }

    function elementsForGroup(group) {
      const els = [];
      if (group.key === "overview") {
        els.push(groupHeader("Overview", COLOR.overviewTextHex), fieldTable(group.rows));
      } else if (group.key === "design") {
        els.push(groupHeader("Design & Effects", COLOR.designAccentHex), designBlock(group));
      } else if (group.key === "details") {
        els.push(groupHeader("Details", COLOR.detailsAccentHex), detailsBlock(group));
      } else if (group.key === "highlights") {
        els.push(groupHeader("Highlights", COLOR.highlightAccentHex), highlightsBlock(group));
      } else if (group.key === "media") {
        els.push(groupHeader("Media", COLOR.mediaAccentHex), mediaBlock(group));
      } else if (group.key === "actions") {
        els.push(groupHeader("Actions", COLOR.actionsAccentHex), actionsBlock(group));
      }
      els.push(new Paragraph({ text: "", spacing: { after: 60 } }));
      return els;
    }

    // Plain box (SEO Metadata / Page Info) - unchanged flat label/value table.
    function plainComponentBlock(title, rows) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: title, bold: true, color: COLOR.titleHex, size: 25 })],
          spacing: { before: 260, after: 60 },
          border: { bottom: { color: COLOR.accentHex, space: 4, style: BorderStyle.SINGLE, size: 16 } },
        }),
        fieldTable(rows),
        new Paragraph({ text: "", spacing: { after: 80 } })
      );
    }

    // Section container: title banner followed by each grouped sub-block,
    // all wrapped visually as one unit via consistent spacing + a top rule.
    function sectionContainer(title, groups) {
      const inner = [
        new Paragraph({
          children: [new TextRun({ text: title, bold: true, color: COLOR.titleHex, size: 27 })],
          spacing: { before: 0, after: 100 },
          border: { bottom: { color: COLOR.accentHex, space: 4, style: BorderStyle.SINGLE, size: 20 } },
        }),
      ];
      groups.forEach((group) => inner.push(...elementsForGroup(group)));

      const outerBorder = { style: BorderStyle.SINGLE, size: 12, color: COLOR.borderHex };
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  borders: { top: outerBorder, bottom: outerBorder, left: outerBorder, right: outerBorder },
                  margins: { top: 160, bottom: 160, left: 160, right: 160 },
                  children: inner,
                }),
              ],
            }),
          ],
        }),
        new Paragraph({ text: "", spacing: { after: 200 } })
      );
    }

    children.push(new Paragraph({ text: scanResult.meta.title || "(untitled)", heading: HeadingLevel.TITLE }));

    const metaRows = [{ label: "URL", value: scanResult.meta.url }];
    if (scanResult.meta.description) metaRows.push({ label: "Meta Description", value: scanResult.meta.description });
    metaRows.push({ label: "Scanned At", value: new Date(scanResult.meta.scannedAt).toLocaleString() });
    metaRows.push({ label: "Total Sections", value: String(scanResult.sections.length) });

    if (scanResult.meta.seo) {
      plainComponentBlock("SEO Metadata", seoRows(scanResult.meta.seo));
    }

    plainComponentBlock("Page Info", metaRows);

    for (const section of scanResult.sections) {
      const groups = groupsForSection(section, opts);
      sectionContainer(titleForSection(section), groups);
      if (onProgress) onProgress();
    }

    const document = new Document({
      sections: [{ properties: {}, children }],
    });

    return Packer.toBlob(document);
  }

  return { preloadImages, buildPdf, buildDocx };
})();
