# 📄 CDGen – CopyDocGenerator

A powerful **Chrome Extension** that scans any webpage and automatically generates professional **PDF** and **Microsoft Word (.docx)** documentation. CDGen extracts webpage content, organizes it into structured sections, and creates clean, downloadable documents suitable for documentation, content audits, and design analysis.

---

## 🚀 Features

- 🔍 Scan any webpage instantly
- 📑 Automatically detects webpage sections
- 📝 Extracts:
  - Headings
  - Paragraphs
  - Buttons
  - Hyperlinks
  - Images
  - Highlights
  - Metadata
- 🎨 Captures section styling information
- 📄 Export documentation as PDF
- 📘 Export documentation as Microsoft Word (.docx)
- ⚡ Fast and lightweight
- 🔒 Built using Chrome Extension Manifest V3
- 📥 Automatically downloads generated documents

---

## 📂 Project Structure

```
HIGH/
│
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
│
├── vendor/
│   ├── docx.iife.js
│   └── jspdf.umd.min.js
│
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── scanner.js
├── doc-builders.js
└── README.md
```

---

## 🛠️ Tech Stack

- HTML5
- CSS3
- JavaScript (ES6)
- Chrome Extension API
- Manifest V3
- jsPDF
- DOCX.js

---

## 📦 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/CDGen.git
```

Or download the ZIP file and extract it.

---

### 2. Open Chrome Extensions

Navigate to:

```
chrome://extensions/
```

---

### 3. Enable Developer Mode

Turn on **Developer Mode** from the top-right corner.

---

### 4. Load the Extension

Click **Load unpacked** and select the extracted **HIGH** project folder.

---

## ▶️ How to Use

1. Open any webpage in Google Chrome.
2. Click the **CDGen** extension icon.
3. Select the desired output format:
   - PDF
   - Microsoft Word (.docx)
4. Click **Scan This Page**.
5. Wait for the scan to complete.
6. The generated document will be downloaded automatically.

---

## 📄 Generated Document Includes

### General Information

- Page Title
- URL
- Scan Date
- Meta Description
- SEO Metadata

### Section Details

Each detected webpage section contains:

- Section Name
- Heading
- Component Type
- Category
- Background Information
- Design Details
- Visual Highlights

### Extracted Content

- Headings
- Paragraphs
- Buttons
- Hyperlinks
- Images
- Button Labels
- Image URLs
- Link URLs
- Accessibility Labels

---

## 📋 Supported Elements

- ✅ Headings
- ✅ Paragraphs
- ✅ Buttons
- ✅ Images
- ✅ Hyperlinks
- ✅ Hero Sections
- ✅ Feature Cards
- ✅ Testimonials
- ✅ FAQ Sections
- ✅ Navigation Bars
- ✅ Footers
- ✅ Content Blocks

---

## 🔒 Permissions Used

| Permission | Purpose |
|------------|---------|
| activeTab | Access the currently opened webpage |
| scripting | Inject webpage scanning scripts |
| downloads | Save generated documents |
| host_permissions | Read webpage content |

---

## 📚 Dependencies

This project includes the following libraries locally:

- **jsPDF** – PDF document generation
- **DOCX.js** – Microsoft Word document generation

---

## 💡 Use Cases

- Website Documentation
- UI/UX Documentation
- Content Audits
- CMS Migration
- SEO Analysis
- Client Deliverables
- Design Reviews
- Accessibility Reviews
- Content Inventory
- Website Archiving

---

## 🔮 Future Enhancements

- Excel Export
- Markdown Export
- JSON Export
- Embedded Screenshots
- Dark Mode Support
- Batch Website Scanning
- Custom Templates
- Cloud Storage Integration
- AI-powered Content Summaries

---

## 👨‍💻 Authors

- **Akilen J K**
- **Abhijith S**
- **Devananth R S**

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Push your branch.
5. Open a Pull Request.

---

## 📄 License

This project is licensed under the **MIT License**.

---

## ⭐ Support

If you found this project helpful, consider giving it a **⭐ Star** on GitHub.

Your support helps improve the project and motivates future development.

---

## 📬 Contact

For suggestions, bug reports, or contributions, feel free to reach out through GitHub by opening an issue or submitting a pull request.
