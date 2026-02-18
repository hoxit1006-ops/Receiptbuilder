# Receipt Spending Tracker (Web)

A mobile-friendly web app where you can take a picture of a receipt and get:
- item list + prices + quantities
- automatic category mapping (including **Fruits** and **Junk Food**)
- totals from receipt text (**subtotal / tax / total**)
- total spent from parsed items
- potential savings if junk food was skipped

## New: AI-assisted extraction (optional)
If OCR misses lines, you can use ChatGPT extraction:
1. Scan/upload receipt (or paste text).
2. Paste your OpenAI API key in the app.
3. Tap **AI parse from OCR text**.
4. Review/edit detected items before saving.

> The API key is used in your browser request and is not stored in localStorage.

## How it works
1. Photo OCR via Tesseract.js reads receipt text.
2. Rule-based parser extracts items + prices + quantity + categories.
3. Parser also extracts subtotal/tax/total fields when present.
4. Optional ChatGPT parse improves extraction quality on messy receipts.
5. You review/edit everything before saving.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173`.

## iPhone usage
- Open the URL in Safari on your iPhone.
- Take a receipt photo.
- Let OCR run.
- If needed, use pasted text fallback or AI parse.
- Save receipt after review.

## Notes
- OCR accuracy depends on image quality.
- Keep receipt flat, well-lit, and fully in frame.
- AI extraction requires internet and a valid OpenAI API key.
