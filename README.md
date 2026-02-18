# Receipt Spending Tracker (Web)

A mobile-friendly web app where you can take a picture of a receipt and get:
- auto-detected items + prices
- automatic category mapping (including **Fruits** and **Junk Food**)
- total spend
- potential savings if junk food was skipped

## New: AI-assisted extraction with Ollama
If OCR misses lines, you can now use **Ollama** to improve extraction:
1. Scan photo (or paste receipt text manually).
2. Enter your local Ollama model name (example: `llama3.1:8b`).
3. Tap **AI parse with Ollama**.
4. Review/edit items and save.

The model name is stored in your browser local storage for convenience.

## Requirements for Ollama
- Install Ollama locally: https://ollama.com
- Pull a model, for example:

```bash
ollama pull llama3.1:8b
```

- Run Ollama server (default):

```bash
ollama serve
```

The web app calls `http://localhost:11434/api/generate`.

## What is improved now
- Better OCR parsing for common receipt line patterns.
- Ollama fallback that converts noisy OCR text into structured JSON items.
- Merchant auto-fill from OCR/AI when possible.
- All extracted rows stay editable before save.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173`.

## iPhone usage
- Open the URL in Safari on your iPhone.
- Take a receipt photo.
- If OCR misses lines, paste text and/or use Ollama parse.
- Review rows, then save.
- Delete any saved receipt from history using the **Delete receipt** button.

## Notes
- OCR and AI quality depends on image clarity.
- Keep receipts flat, well-lit, and fully in frame.
- Ollama parsing requires the browser/device to reach your Ollama server URL.
