# CDGen — Chrome Extension

Scans the current web page section-by-section and generates a **PDF** and a
**Word (.docx)** document. A single **SEO Metadata** box appears first,
followed by a **Page Info** box, then one **box per section**, titled with
its detected semantic name — **Hero**, **Testimonial / Review**, **Card
Section / Feature Grid**, **Pricing**, **FAQ**, **Footer**, etc. — falling
back to "Content Section" when nothing more specific matches.

Within each section's box, the content is split into its own styled
sub-panels instead of one flat table, so each kind of field is visually
distinct:

- **Overview** — Section Name, Section Type (structural category, e.g.
  "Content Card"/"Area Heading"), Component Name (WordPress block / React
  component when detected), Heading Text, Heading Level.
- **Design & Effects** — the section's background (solid color as hex,
  gradient, or image — noting if it's inherited from a parent element),
  a bulleted list of visual effects in use (drop shadow, rounded corners,
  gradient background, backdrop blur/glass, filter, animation, reduced
  opacity, transform), and a **Depth Effect: Yes/No** badge (true when a
  shadow and/or backdrop blur is present).
- **Details** — paragraph/list/blockquote/table-cell text, shown on a
  tinted card with a colored left accent bar.
- **Highlights** — every `<strong>`, `<b>`, `<em>`, `<i>`, `<mark>` span in
  the section, each shown as its own chip tagged BOLD / ITALIC / MARK
  (color-coded per kind) inside an amber highlight card.
- **Media** — one bordered card per image, with its thumbnail (if
  embedding is on), Alt Text, and Image link.
- **Actions** — buttons rendered as filled pill-style cards (Text, Type,
  Aria Label, Link), links rendered as outlined cards (Text, URL, Aria
  Label, Target).

A section only gets the sub-panels it actually has content for — e.g. a
heading-only section shows just an Overview panel.

### Works on WordPress and any other site

Section boundaries and styling are read from generic DOM/CSS (headings,
computed styles), not anything WordPress-specific, so CDGen works on plain
HTML sites, single-page apps, and WordPress alike. For WordPress specifically:

- Section naming and Design & Effects analysis look for the nearest real
  section wrapper, recognizing common page-builder markup (Elementor,
  Divi, WPBakery, Beaver Builder, Bricks) as well as Gutenberg
  `wp-block-group`/`wp-block-cover`/`wp-block-columns` blocks.
- If the page has no `<main>`/`<article>`, CDGen falls back to common
  WordPress content-wrapper IDs/classes (`#content`, `.site-content`,
  `#main`, `.elementor`, `#page`) before finally falling back to `<body>`.

## Install (unpacked, for Chrome / Edge / Brave)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension directly from these files).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `CDGen` folder.
5. The CDGen icon appears in your toolbar. Pin it if you'd like.

## Use it

1. Open any regular web page (`http://` or `https://`).
2. Click the **CDGen** toolbar icon.
3. Choose your options:
   - **Embed image thumbnails** — best-effort; fetches and downsizes images
     found on the page so they appear directly in the PDF/Word doc, not just
     as URLs. Some images may fail to embed (CORS-protected images, etc.) —
     their URL is still always listed as text.
   - **Include links** — lists the links found within each section.
4. Click **Scan This Page**.
5. Two files are saved to `Downloads/CDGen/<page-title>.pdf` and
   `Downloads/CDGen/<page-title>.docx`.

## How sections are detected

The page is split using its heading elements (`<h1>`–`<h6>`) in document
order — each heading starts a new section that runs until the next heading.
Within each section, CDGen collects:

- **Details** — paragraph, list-item, blockquote, and table-cell text
- **Highlights** — `<strong>`, `<b>`, `<em>`, `<mark>` text
- **Images** — resolved absolute image URLs + alt text (+ thumbnail if embedding is on)
- **Links** — link text + resolved absolute URL

If a page has no headings at all, it's exported as a single "Page Content" section.

## Notes & limitations

- Content behind logins, iframes from other origins, or rendered only after
  further user interaction (infinite scroll, "load more" buttons, etc.) may
  not be captured — CDGen scans the page as currently loaded/rendered.
- Image embedding depends on the image being fetchable by the extension
  (public, non-CORS-blocked images work best).
- Internal browser pages (`chrome://`, the Web Store, etc.) can't be scanned —
  this is a Chrome platform restriction on all extensions.

## Files

- `manifest.json` — Chrome extension manifest (Manifest V3)
- `popup.html` / `popup.css` / `popup.js` — the toolbar popup UI and orchestration
- `scanner.js` — the page-scanning logic injected into the active tab
- `doc-builders.js` — builds the PDF (jsPDF) and Word doc (docx.js) from scan results
- `vendor/` — bundled copies of jsPDF and docx.js (required by Manifest V3;
  extensions can't load remote scripts)
