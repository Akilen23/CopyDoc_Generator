/**
 * CDGen page scanner.
 *
 * cdgenScanPage() is injected into the inspected tab via
 * chrome.scripting.executeScript({ func: cdgenScanPage }).
 * It must be fully self-contained (no references to outer scope)
 * because it is serialized and re-executed inside the page.
 *
 * Produces an ordered stream of labeled "entries" per section (split by
 * heading, as before) so the generated doc can be rendered as a
 * CMS-style content dump: value, then Label / Value pairs, in document
 * order — e.g.:
 *
 *   Add it now
 *   Link Text
 *   Add it now
 *   Link URL
 *   https://example.com/...
 *   Aria Label
 *   Add it now
 *
 * Returns:
 * {
 *   meta: { title, url, description, scannedAt, seo: {...} },
 *   sections: [
 *     {
 *       index, level, heading, sectionName, componentName, category,
 *       design: { background, effects, depthEffect },
 *       highlights,
 *       entries: [
 *         { type: "heading", text, level },
 *         { type: "text", text },
 *         { type: "highlight", text, kind },
 *         { type: "image", alt, src },
 *         { type: "button", text, ariaLabel },
 *         { type: "link", text, href, ariaLabel, target },
 *         ...
 *       ]
 *     }, ...
 *   ]
 * }
 *
 * Each section also carries:
 *   - sectionName: semantic section type guessed from tag/class/id/heading
 *     keywords (e.g. "Hero", "Testimonial / Review", "Card Section /
 *     Feature Grid", "FAQ", "Footer"), falling back to "Content Section".
 *   - componentName: best-effort name of the WordPress block / React component
 *     that rendered the section (e.g. "WordPress Block: Cover",
 *     "React Component: HeroSection"), or "" if none could be detected.
 *   - design: { background, effects, depthEffect } read from the section's
 *     nearest wrapper element -- background color/gradient/image, a list of
 *     visual effects in use (shadow, rounded corners, blur, animation,
 *     opacity, transform), and whether a "depth" effect (shadow and/or
 *     backdrop blur) is present.
 *   - highlights: flattened array of { text, kind } pulled from the
 *     section's "highlight" entries, for easy single-column rendering.
 */
function cdgenScanPage() {
  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && !el.matches("br,wbr")) {
      // Allow off-screen elements (e.g. above the fold) but skip zero-size collapsed ones.
      if (el.offsetParent === null && style.position !== "fixed") return false;
    }
    return true;
  }

  function cleanText(str) {
    return (str || "").replace(/\s+/g, " ").trim();
  }

  function absoluteUrl(url) {
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url || "";
    }
  }

  function isButtonish(el) {
    if (el.tagName === "BUTTON") return true;
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type || "")) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "button") return true;
    const cls = (el.className || "").toString().toLowerCase();
    if (el.tagName === "A" && /\bbtn\b|\bbutton\b/.test(cls)) return true;
    return false;
  }

  function getFontInfo(el) {
    try {
      const cs = window.getComputedStyle(el);
      const family = (cs.fontFamily || "").split(",")[0].replace(/["']/g, "").trim() || "inherit";
      const size = cs.fontSize ? `${Math.round(parseFloat(cs.fontSize))}px` : "";
      const weightRaw = cs.fontWeight || "400";
      const weightNum = parseInt(weightRaw, 10);
      let weight = "Regular";
      if (/^bold$/i.test(weightRaw) || weightNum >= 700) weight = "Bold";
      else if (weightNum >= 600) weight = "Semibold";
      else if (weightNum >= 500) weight = "Medium";
      const italic = cs.fontStyle === "italic" ? "Italic" : "";
      return { family, size, weight, italic };
    } catch (e) {
      return { family: "", size: "", weight: "", italic: "" };
    }
  }

  function classListOf(node) {
    if (!node || !node.getAttribute) return "";
    if (node.className && typeof node.className === "string") return node.className;
    if (node.classList) return Array.from(node.classList).join(" ");
    return "";
  }

  function titleCase(str) {
    return (str || "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  // ---------------------------------------------------------------------
  // Section container + semantic name + visual design detection
  // ---------------------------------------------------------------------

  // Wrapper selectors used by common WordPress page builders and generic
  // themes, checked when climbing up from a heading to find the element
  // that actually represents "the section" for styling purposes.
  const SECTION_WRAPPER_SELECTOR = [
    "section", "header", "footer", "article", "aside", "nav",
    ".elementor-section", ".elementor-top-section", ".elementor-container",
    ".et_pb_section", ".et_pb_row",
    ".vc_row", ".vc_section",
    ".fl-row", ".fl-row-content-wrap",
    ".ct-section",
    ".wp-block-group", ".wp-block-cover", ".wp-block-columns",
    "[class*='section']", "[class*='container']", "[class*='wrapper']",
  ].join(",");

  // Climbs from a heading (or first content node) up to the nearest element
  // that looks like the actual section wrapper, so background/effects are
  // read from the right element instead of the heading's own <h2> tag.
  function containerFor(startEl, root) {
    let node = startEl;
    let fallback = startEl;
    for (let i = 0; i < 10 && node && node !== root && node !== document.body; i++) {
      if (node.matches && node.matches(SECTION_WRAPPER_SELECTOR)) return node;
      fallback = node;
      node = node.parentElement;
    }
    return fallback || startEl;
  }

  // Semantic section naming: Hero, Testimonial, Pricing, FAQ, etc. Checked
  // against tag name (landmark elements), then class/id/aria-label/heading
  // text keywords -- works the same whether the markup came from WordPress
  // (Elementor/Divi/Gutenberg/etc.), a custom theme, or any other site.
  const SECTION_NAME_RULES = [
    { name: "Hero", pattern: /\bhero\b|\bbanner\b|\bjumbotron\b|\bmasthead\b/i },
    { name: "Call to Action (CTA)", pattern: /\bcta\b|call[-_]?to[-_]?action/i },
    { name: "Testimonial / Review", pattern: /testimonial|\breview[s]?\b|\brating[s]?\b|\bquote[s]?\b/i },
    { name: "Pricing", pattern: /pricing|price[-_]table|\bplans?\b/i },
    { name: "FAQ", pattern: /\bfaq\b|frequently[-_]asked|accordion/i },
    { name: "Team", pattern: /\bteam\b|\bstaff\b|\bmembers?\b/i },
    { name: "Gallery", pattern: /gallery|portfolio|showcase|lightbox/i },
    { name: "Card Section / Feature Grid", pattern: /\bcards?\b|\bfeatures?\b|\bservices?\b|\bcolumns?\b|\bgrid\b/i },
    { name: "Stats / Numbers", pattern: /\bstats?\b|\bcounter[s]?\b|\bmetrics?\b/i },
    { name: "Newsletter / Subscribe", pattern: /newsletter|subscribe|sign[-_]?up/i },
    { name: "Contact", pattern: /\bcontact\b/i },
    { name: "Blog / Articles", pattern: /\bblog\b|\barticles?\b|\bposts?\b/i },
    { name: "Logos / Partners", pattern: /\blogos?\b|\bpartners?\b|\bclients?\b|\bbrands?\b/i },
    { name: "Comments", pattern: /\bcomments?\b/i },
  ];

  function detectSectionName(container, headingText) {
    // Strong structural landmarks first.
    if (container.tagName === "HEADER") return "Header";
    if (container.tagName === "FOOTER") return "Footer";
    if (container.tagName === "NAV") return "Navigation";
    if (container.tagName === "ASIDE") return "Sidebar";

    const haystack = [
      classListOf(container),
      container.id || "",
      container.getAttribute ? (container.getAttribute("aria-label") || "") : "",
      headingText || "",
    ].join(" ").toLowerCase();

    for (const rule of SECTION_NAME_RULES) {
      if (rule.pattern.test(haystack)) return rule.name;
    }
    return "Content Section";
  }

  function rgbToHex(rgbStr) {
    const m = (rgbStr || "").match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return rgbStr || "";
    const r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10);
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a === 0) return "Transparent";
    const hex = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
    return a < 1 ? `${hex} (${Math.round(a * 100)}% opacity)` : hex;
  }

  // Walks up from the container to find the first non-transparent
  // background if the section itself has none set directly (it may be
  // inheriting the page/body background).
  function describeBackground(container) {
    let node = container;
    let cs = window.getComputedStyle(node);
    let bg = cs.backgroundColor;
    let hops = 0;
    let inherited = false;
    while (node && hops < 4 && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent" || !bg)) {
      node = node.parentElement;
      if (!node) break;
      cs = window.getComputedStyle(node);
      bg = cs.backgroundColor;
      hops++;
      inherited = true;
    }
    const colorLabel = (bg === "rgba(0, 0, 0, 0)" || bg === "transparent" || !bg)
      ? "Transparent / inherits page background"
      : `${rgbToHex(bg)}${inherited ? " (inherited from a parent element)" : ""}`;

    const ownBgImage = window.getComputedStyle(container).backgroundImage;
    let imageNote = "";
    if (ownBgImage && ownBgImage !== "none") {
      imageNote = /gradient/i.test(ownBgImage) ? " + gradient overlay" : " + background image";
    }
    return colorLabel + imageNote;
  }

  // Best-effort read of visual effects applied to the section wrapper:
  // shadows, rounded corners, gradients, blur/glass effects, animation,
  // and transparency -- plus a simple depth-effect yes/no signal (shadow
  // and/or backdrop blur are the two effects that create visual "depth").
  function detectEffects(container) {
    const cs = window.getComputedStyle(container);
    const effects = [];
    let depthEffect = false;

    if (cs.boxShadow && cs.boxShadow !== "none") {
      effects.push("Drop shadow");
      depthEffect = true;
    }
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    if (radius > 0) effects.push(`Rounded corners (${Math.round(radius)}px)`);

    if (/gradient/i.test(cs.backgroundImage || "")) {
      effects.push("Gradient background");
    } else if (cs.backgroundImage && cs.backgroundImage !== "none") {
      effects.push("Background image");
    }

    const backdrop = cs.backdropFilter || cs.webkitBackdropFilter || "none";
    if (backdrop && backdrop !== "none") {
      effects.push("Backdrop blur / glass effect");
      depthEffect = true;
    }
    if (cs.filter && cs.filter !== "none") effects.push("Filter effect (blur/brightness/contrast)");
    if (cs.animationName && cs.animationName !== "none") effects.push("CSS animation");

    const opacity = parseFloat(cs.opacity);
    if (!isNaN(opacity) && opacity < 1) effects.push(`Reduced opacity (${Math.round(opacity * 100)}%)`);

    if (cs.transform && cs.transform !== "none") effects.push("Transform applied (scale/translate/rotate)");

    return { effects: effects.length ? effects : ["No special effects detected"], depthEffect };
  }

  // Best-effort detection of the WordPress block or React/Vue component that
  // rendered a given element, by walking up the DOM a few levels.
  function detectComponentName(el) {
    let node = el;
    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      const cls = classListOf(node);

      // WordPress core/plugin blocks: class names like "wp-block-cover",
      // "wp-block-woocommerce-product-collection", etc.
      const wpMatch = cls.match(/\bwp-block-([a-z0-9-]+)\b/i);
      if (wpMatch) {
        return `WordPress Block: ${titleCase(wpMatch[1])}`;
      }

      // Explicit component hints some frameworks/dev teams add themselves.
      if (node.getAttribute) {
        const explicit =
          node.getAttribute("data-component") ||
          node.getAttribute("data-component-name") ||
          node.getAttribute("data-testid") ||
          node.getAttribute("data-block-name");
        if (explicit) return `Component: ${explicit}`;
      }

      // React fiber introspection (best-effort; React attaches an internal
      // key like "__reactFiber$xxxxx" to DOM nodes it manages).
      try {
        const fiberKey = Object.keys(node).find(
          (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
        );
        if (fiberKey) {
          let fiber = node[fiberKey];
          let depth = 0;
          while (fiber && depth < 10) {
            const t = fiber.type;
            const name = typeof t === "function" ? t.name || (t.displayName) : (t && t.displayName);
            if (name && /^[A-Z]/.test(name)) {
              return `React Component: ${name}`;
            }
            fiber = fiber.return;
            depth++;
          }
        }
      } catch (e) {
        /* ignore, fiber shape can vary between React versions */
      }

      node = node.parentElement;
    }
    return "";
  }

  function extractSEO() {
    function metaContent(selector) {
      const el = document.querySelector(selector);
      return el ? cleanText(el.getAttribute("content") || "") : "";
    }
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    return {
      metaTitle: cleanText(document.title),
      metaDescription: metaContent('meta[name="description"]'),
      metaKeywords: metaContent('meta[name="keywords"]'),
      robots: metaContent('meta[name="robots"]'),
      viewport: metaContent('meta[name="viewport"]'),
      canonical: canonicalEl ? absoluteUrl(canonicalEl.getAttribute("href")) : "",
      ogTitle: metaContent('meta[property="og:title"]'),
      ogDescription: metaContent('meta[property="og:description"]'),
      ogImage: metaContent('meta[property="og:image"]'),
      ogType: metaContent('meta[property="og:type"]'),
      ogUrl: metaContent('meta[property="og:url"]'),
      twitterCard: metaContent('meta[name="twitter:card"]'),
      twitterTitle: metaContent('meta[name="twitter:title"]'),
      twitterDescription: metaContent('meta[name="twitter:description"]'),
      twitterImage: metaContent('meta[name="twitter:image"]'),
      h1Count: String(document.querySelectorAll("h1").length),
    };
  }

  // Best-effort categorization of a section into a recognizable component type,
  // similar to how CMS component libraries name their building blocks
  // (Content Card, Area Heading, Highlight banner, Card, Unknown Component).
  function categorizeSection(sectionIndex, hasHeading, textCount, imageCount, linkCount, buttonCount) {
    const hasBody = textCount > 0;
    const hasCTA = linkCount > 0 || buttonCount > 0;

    if (hasHeading && !hasBody && imageCount === 0 && !hasCTA) return "Area Heading";
    if (!hasHeading && !hasBody && imageCount === 0 && !hasCTA) return "Unknown Component";
    if (!hasHeading && !hasBody && (imageCount > 0 || hasCTA)) return "Unknown Component";
    if (sectionIndex <= 1 && hasHeading && hasBody) return "Highlight";
    if (hasHeading && hasBody && hasCTA) return imageCount > 0 ? "Card" : "Content Card";
    if (hasHeading && hasBody) return "Content Card";
    return "Unknown Component";
  }

  // Prefer a semantic wrapper; fall back through common WordPress theme /
  // page-builder content wrapper IDs/classes before giving up to <body>, so
  // scanning works whether the page is WordPress (any theme/builder), a
  // custom site, or anything else.
  const root =
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.querySelector("#content, .site-content, #main, .elementor, #page") ||
    document.body;

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);
  const TEXT_TAGS = new Set(["P", "LI", "BLOCKQUOTE", "TD", "TH", "DT", "DD", "FIGCAPTION", "SUMMARY"]);
  const HIGHLIGHT_TAGS = new Set(["STRONG", "B", "EM", "I", "MARK"]);

  let headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .filter((h) => isVisible(h) && cleanText(h.textContent).length > 0);

  // De-duplicate headings that share identical text back-to-back (common with sticky/duplicate nav headers)
  headings = headings.filter((h, i) => {
    if (i === 0) return true;
    const prev = headings[i - 1];
    return !(prev.textContent === h.textContent && prev.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING && h.getBoundingClientRect().top - prev.getBoundingClientRect().top < 2 && h !== prev);
  });

  const sections = [];

  function collectNodesBetween(startEl, endEl) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => (SKIP_TAGS.has(node.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    if (startEl) walker.currentNode = startEl;
    let node = walker.nextNode();
    while (node && node !== endEl) {
      nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  }

  function buildSection(index, headingEl, nextHeadingEl) {
    const level = headingEl ? parseInt(headingEl.tagName.substring(1), 10) : 0;
    const headingText = headingEl ? cleanText(headingEl.textContent) : "Page Content";

    const entries = [];
    if (headingEl) {
      entries.push({ type: "heading", text: headingText, level, font: getFontInfo(headingEl) });
    }

    const seenImg = new Set();
    const seenLink = new Set();
    const seenText = new Set();
    const seenHighlight = new Set();

    const nodes = collectNodesBetween(headingEl, nextHeadingEl);

    nodes.forEach((el) => {
      if (!isVisible(el)) return;
      const tag = el.tagName;

      if (tag === "IMG") {
        const src = el.src ? absoluteUrl(el.src) : "";
        if (src && !seenImg.has(src)) {
          seenImg.add(src);
          entries.push({ type: "image", alt: cleanText(el.alt) || "Not provided", src });
        }
        return;
      }

      if (tag === "A" && el.href) {
        const href = absoluteUrl(el.href);
        const text = cleanText(el.innerText || el.textContent) || href;
        const ariaLabel = cleanText(el.getAttribute("aria-label")) || "";
        const target = el.getAttribute("target") || "_self";
        const key = "a|" + href + "|" + text;
        if (href && !href.startsWith("javascript:") && !seenLink.has(key)) {
          seenLink.add(key);
          if (isButtonish(el)) {
            entries.push({ type: "button", text, ariaLabel: ariaLabel || text, buttonType: "button", href });
          } else {
            entries.push({ type: "link", text, href, ariaLabel: ariaLabel || text, target });
          }
        }
        return;
      }

      if (tag === "BUTTON" || (tag === "INPUT" && /^(button|submit|reset)$/i.test(el.type || ""))) {
        const text = cleanText(el.innerText || el.textContent || el.value) || "";
        const ariaLabel = cleanText(el.getAttribute("aria-label")) || text;
        const buttonType = el.getAttribute("type") || "button";
        const key = "btn|" + text + "|" + ariaLabel;
        if (text && !seenLink.has(key)) {
          seenLink.add(key);
          entries.push({ type: "button", text, ariaLabel, buttonType });
        }
        return;
      }

      if (HIGHLIGHT_TAGS.has(tag)) {
        // Skip highlights inside links/buttons (already captured as link/button text).
        if (el.closest("a[href], button")) return;
        const hasNestedHighlight = Array.from(el.children).some((c) => HIGHLIGHT_TAGS.has(c.tagName));
        const txt = cleanText(el.innerText || el.textContent);
        if (txt && !hasNestedHighlight) {
          const key = tag + "|" + txt;
          if (!seenHighlight.has(key)) {
            seenHighlight.add(key);
            const kind = tag === "MARK" ? "Highlighted (mark)" : (tag === "EM" || tag === "I") ? "Italic" : "Bold";
            entries.push({ type: "highlight", text: txt, kind, font: getFontInfo(el) });
          }
        }
        return;
      }

      if (TEXT_TAGS.has(tag)) {
        // Skip text already captured as link/button text (avoid duplicating "Add it now" as both
        // a link entry and a plain paragraph entry).
        if (el.closest("a[href], button")) return;
        const hasNestedTextTag = Array.from(el.children).some((c) => TEXT_TAGS.has(c.tagName));
        const txt = cleanText(el.innerText || el.textContent);
        if (txt && !hasNestedTextTag) {
          const prefix = tag === "LI" ? "• " : "";
          const line = prefix + txt;
          if (!seenText.has(line)) {
            seenText.add(line);
            entries.push({ type: "text", text: line, font: getFontInfo(el) });
          }
        }
        return;
      }

      if (tag === "DIV" || tag === "SPAN" || tag === "SECTION") {
        // Text-only leaf containers (no element children) count as paragraph-like content.
        if (el.children.length === 0 && !el.closest("a[href], button")) {
          const txt = cleanText(el.textContent);
          if (txt && txt.length > 1 && !seenText.has(txt)) {
            seenText.add(txt);
            entries.push({ type: "text", text: txt, font: getFontInfo(el) });
          }
        }
      }
    });

    const componentAnchor = headingEl || nodes[0] || root;
    const componentName = detectComponentName(componentAnchor);
    const highlights = entries
      .filter((e) => e.type === "highlight")
      .map((e) => ({ text: e.text, kind: e.kind }));

    const textCount = entries.filter((e) => e.type === "text").length;
    const imageCount = entries.filter((e) => e.type === "image").length;
    const linkCount = entries.filter((e) => e.type === "link").length;
    const buttonCount = entries.filter((e) => e.type === "button").length;
    const category = categorizeSection(index, !!headingEl, textCount, imageCount, linkCount, buttonCount);

    const styleContainer = containerFor(componentAnchor, root);
    const sectionName = detectSectionName(styleContainer, headingText);
    const { effects, depthEffect } = detectEffects(styleContainer);
    const design = { background: describeBackground(styleContainer), effects, depthEffect };

    return { index, level, heading: headingText, sectionName, componentName, category, design, highlights, entries };
  }

  if (headings.length === 0) {
    sections.push(buildSection(1, null, null));
  } else {
    headings.forEach((h, i) => {
      const next = headings[i + 1] || null;
      sections.push(buildSection(i + 1, h, next));
    });
  }

  const descriptionMeta = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');

  return {
    meta: {
      title: cleanText(document.title),
      url: window.location.href,
      description: descriptionMeta ? cleanText(descriptionMeta.content) : "",
      scannedAt: new Date().toISOString(),
      seo: extractSEO(),
    },
    sections,
  };
}
