const STORAGE_KEY = 'receipt_spending_tracker_v4';
const CATEGORIES = ['Fruits', 'Junk Food', 'Vegetables', 'Protein', 'Dairy', 'Drinks', 'Snacks', 'Household', 'Other'];
const JUNK_CATEGORIES = new Set(['Junk Food']);

const CATEGORY_KEYWORDS = {
  Fruits: ['apple', 'banana', 'orange', 'grape', 'berry', 'strawberry', 'blueberry', 'mango', 'avocado', 'peach', 'pear', 'melon', 'pineapple', 'kiwi', 'fruit'],
  'Junk Food': ['chips', 'soda', 'coke', 'pepsi', 'candy', 'chocolate', 'cookies', 'cookie', 'ice cream', 'donut', 'doughnut', 'pizza', 'fries', 'burger', 'energy drink'],
  Vegetables: ['lettuce', 'tomato', 'onion', 'carrot', 'broccoli', 'spinach', 'pepper', 'cucumber', 'vegetable'],
  Protein: ['chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna', 'egg', 'eggs', 'turkey', 'protein'],
  Dairy: ['milk', 'cheese', 'yogurt', 'butter', 'cream'],
  Drinks: ['juice', 'water', 'coffee', 'tea', 'drink'],
  Snacks: ['nuts', 'granola', 'cracker', 'trail mix', 'snack'],
  Household: ['detergent', 'soap', 'paper towel', 'toilet paper', 'cleaner', 'trash bag']
};

const merchantInput = document.getElementById('merchant');
const dateInput = document.getElementById('purchaseDate');
const photoInput = document.getElementById('photo');
const photoPreview = document.getElementById('photoPreview');
const ocrTextInput = document.getElementById('ocrText');
const parseTextButton = document.getElementById('parseText');
const aiParseButton = document.getElementById('aiParse');
const openaiKeyInput = document.getElementById('openaiKey');
const scanReceiptButton = document.getElementById('scanReceipt');
const scanStatus = document.getElementById('scanStatus');
const itemsContainer = document.getElementById('items');
const addItemButton = document.getElementById('addItem');
const saveReceiptButton = document.getElementById('saveReceipt');
const totalSpentEl = document.getElementById('totalSpent');
const junkSavingsEl = document.getElementById('junkSavings');
const receiptTotalsInfoEl = document.getElementById('receiptTotalsInfo');
const categorySummaryEl = document.getElementById('categorySummary');
const receiptListEl = document.getElementById('receiptList');

let receipts = [];
let imageDataUrl = '';
let currentParsedTotals = { subtotal: 0, tax: 0, total: 0 };

function createEmptyItem(item = {}) {
  return {
    name: item.name || '',
    price: item.price ? String(item.price) : '',
    quantity: item.quantity ? String(item.quantity) : '1',
    category: item.category || 'Other'
  };
}

function guessCategory(name) {
  const lower = String(name || '').toLowerCase();
  const matched = Object.entries(CATEGORY_KEYWORDS).find(([, keywords]) => keywords.some((keyword) => lower.includes(keyword)));
  return matched ? matched[0] : 'Other';
}

function cleanupLine(line) {
  return line.replace(/[|]/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

function extractMerchant(text) {
  const lines = String(text).split(/\r?\n/).map(cleanupLine).filter(Boolean).slice(0, 6);
  return lines.find((line) => /[A-Za-z]{3,}/.test(line) && !/receipt|invoice|thank|date|time/i.test(line)) || '';
}

function amountFromString(value) {
  const normalized = String(value || '').replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parseTotals(text) {
  const lines = String(text).split(/\r?\n/).map(cleanupLine).filter(Boolean);
  const result = { subtotal: 0, tax: 0, total: 0 };

  for (const line of lines) {
    const amountMatch = line.match(/(\d{1,4}[\.,]\d{2})\s*$/);
    if (!amountMatch) continue;
    const amount = amountFromString(amountMatch[1]);

    if (/subtotal/i.test(line)) result.subtotal = amount;
    else if (/\btax\b|vat/i.test(line)) result.tax = amount;
    else if (/\btotal\b|amount due|grand total/i.test(line)) result.total = amount;
  }

  return result;
}

function parseReceiptText(text) {
  const lines = String(text).split(/\r?\n/).map(cleanupLine).filter(Boolean);
  const skipPattern = /subtotal|tax|total|balance|change|visa|mastercard|debit|credit|cash|thank|invoice|order|auth|payment/i;
  const parsedItems = [];
  const seen = new Set();

  for (const line of lines) {
    if (skipPattern.test(line)) continue;

    const tokens = line.match(/\d{1,4}[\.,]\d{2}/g) || [];
    if (!tokens.length) continue;

    const lastToken = tokens[tokens.length - 1];
    const price = amountFromString(lastToken);
    if (!Number.isFinite(price) || price <= 0 || price > 9999) continue;

    const qtyMatch = line.match(/(?:^|\s)(\d+)\s*[xX](?:\s|$)/);
    const quantity = qtyMatch ? Math.max(1, Number(qtyMatch[1])) : 1;

    const name = line
      .replace(/\$?\s*\d{1,4}[\.,]\d{2}\s*$/g, '')
      .replace(/(?:^|\s)\d+\s*[xX](?:\s|$)/g, ' ')
      .replace(/[\-#:*]+$/g, '')
      .trim();

    if (name.length < 2 || /^\d+$/.test(name)) continue;

    const key = `${name.toLowerCase()}|${price}|${quantity}`;
    if (seen.has(key)) continue;
    seen.add(key);

    parsedItems.push({ name, price, quantity, category: guessCategory(name) });
  }

  currentParsedTotals = parseTotals(text);
  return parsedItems;
}

async function parseWithOpenAI(rawText, apiKey) {
  const prompt = `Extract structured receipt data. Return JSON only with shape: {"merchant":"string","subtotal":number,"tax":number,"total":number,"items":[{"name":"string","price":number,"quantity":number,"category":"Fruits|Junk Food|Vegetables|Protein|Dairy|Drinks|Snacks|Household|Other"}]}. Receipt text:\n${rawText}`;

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: prompt,
      temperature: 0
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const output = data.output_text || '';
  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) throw new Error('No JSON returned by AI');

  const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  return {
    merchant: String(parsed.merchant || '').trim(),
    subtotal: amountFromString(parsed.subtotal),
    tax: amountFromString(parsed.tax),
    total: amountFromString(parsed.total),
    items: items
      .map((item) => ({
        name: String(item.name || '').trim(),
        price: amountFromString(item.price),
        quantity: Math.max(1, Number(item.quantity || 1)),
        category: CATEGORIES.includes(item.category) ? item.category : guessCategory(item.name || '')
      }))
      .filter((item) => item.name && item.price > 0)
  };
}

function addItemRow(item = createEmptyItem()) {
  const row = document.createElement('div');
  row.className = 'item-row';
  const nameInput = document.createElement('input');
  nameInput.placeholder = 'Item name';
  nameInput.value = item.name;

  const grid = document.createElement('div');
  grid.className = 'grid-2';
  const priceInput = document.createElement('input');
  priceInput.placeholder = 'Price';
  priceInput.inputMode = 'decimal';
  priceInput.value = item.price;

  const qtyInput = document.createElement('input');
  qtyInput.placeholder = 'Qty';
  qtyInput.inputMode = 'numeric';
  qtyInput.value = item.quantity;

  const categorySelect = document.createElement('select');
  CATEGORIES.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    if (category === item.category) option.selected = true;
    categorySelect.appendChild(option);
  });

  const removeButton = document.createElement('button');
  removeButton.className = 'btn-danger';
  removeButton.textContent = 'Remove item';
  removeButton.type = 'button';
  removeButton.addEventListener('click', () => row.remove());

  grid.append(priceInput, qtyInput);
  row.append(nameInput, grid, categorySelect, removeButton);
  itemsContainer.appendChild(row);
}

function setItemRows(items) {
  itemsContainer.innerHTML = '';
  if (!items.length) return addItemRow();
  items.forEach((item) => addItemRow(createEmptyItem(item)));
}

function readItemRows() {
  return [...itemsContainer.children]
    .map((row) => {
      const [name, grid, category] = row.children;
      const [price, quantity] = grid.children;
      return {
        name: name.value.trim(),
        price: amountFromString(price.value),
        quantity: Math.max(1, Number(quantity.value || 1)),
        category: category.value || 'Other'
      };
    })
    .filter((item) => item.name && item.price > 0);
}

function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price * item.quantity, 0); }
function calculateJunkTotal(items) { return items.filter((item) => JUNK_CATEGORIES.has(item.category)).reduce((sum, item) => sum + item.price * item.quantity, 0); }
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(receipts)); }
function loadState() { receipts = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }

function renderSummary() {
  const total = receipts.reduce((sum, receipt) => sum + receipt.total, 0);
  const junkTotal = receipts.reduce((sum, receipt) => sum + (receipt.junkSpend || 0), 0);
  const totalsAgg = receipts.reduce((acc, receipt) => {
    acc.subtotal += receipt.subtotal || 0;
    acc.tax += receipt.tax || 0;
    acc.total += receipt.receiptTotal || 0;
    return acc;
  }, { subtotal: 0, tax: 0, total: 0 });

  totalSpentEl.textContent = `$${total.toFixed(2)}`;
  junkSavingsEl.textContent = `Potential savings (skip junk food): $${junkTotal.toFixed(2)}`;
  receiptTotalsInfoEl.textContent = `Parsed receipt totals: Subtotal $${totalsAgg.subtotal.toFixed(2)}, Tax $${totalsAgg.tax.toFixed(2)}, Total $${totalsAgg.total.toFixed(2)}`;

  const byCategory = {};
  receipts.forEach((receipt) => receipt.items.forEach((item) => { byCategory[item.category] = (byCategory[item.category] || 0) + item.price * item.quantity; }));

  categorySummaryEl.innerHTML = '';
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return (categorySummaryEl.innerHTML = '<span class="small">No spending yet.</span>');

  entries.forEach(([category, amount]) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = `${category}: $${amount.toFixed(2)}`;
    categorySummaryEl.appendChild(chip);
  });
}

function renderReceipts() {
  receiptListEl.innerHTML = '';
  if (!receipts.length) return (receiptListEl.innerHTML = '<div class="small">No receipts uploaded yet.</div>');

  receipts.forEach((receipt) => {
    const card = document.createElement('article');
    card.className = 'receipt';
    const itemsHtml = receipt.items.map((item) => `• ${item.name} (${item.category}) x${item.quantity} - $${item.price.toFixed(2)}`).join('<br>');

    card.innerHTML = `
      <h3>${receipt.merchant}</h3>
      <div class="small">${receipt.purchaseDate}</div>
      <div class="small">Items total: $${receipt.total.toFixed(2)}</div>
      <div class="small">Receipt subtotal/tax/total: $${(receipt.subtotal || 0).toFixed(2)} / $${(receipt.tax || 0).toFixed(2)} / $${(receipt.receiptTotal || 0).toFixed(2)}</div>
      <div class="small">Possible junk-food savings: $${(receipt.junkSpend || 0).toFixed(2)}</div>
      <div class="small" style="margin-top: 8px;">${itemsHtml}</div>
      ${receipt.imageDataUrl ? `<img class="thumb" src="${receipt.imageDataUrl}" alt="${receipt.merchant} receipt" />` : ''}
    `;
    receiptListEl.appendChild(card);
  });
}

function resetForm() {
  merchantInput.value = '';
  dateInput.valueAsDate = new Date();
  photoInput.value = '';
  ocrTextInput.value = '';
  imageDataUrl = '';
  currentParsedTotals = { subtotal: 0, tax: 0, total: 0 };
  photoPreview.hidden = true;
  photoPreview.removeAttribute('src');
  scanStatus.textContent = '';
  itemsContainer.innerHTML = '';
  addItemRow();
}

function applyParsedItems(parsedItems, source = 'scan') {
  if (!parsedItems.length) {
    scanStatus.textContent = `Could not parse items from ${source}. You can still add/edit items manually.`;
    if (!itemsContainer.children.length) addItemRow();
    return;
  }
  setItemRows(parsedItems);
  scanStatus.textContent = `Parsed ${parsedItems.length} item(s) from ${source}. Review before saving.`;
}

async function scanReceiptWithOcr() {
  if (!imageDataUrl) return alert('Please take/upload a receipt photo first.');
  scanReceiptButton.disabled = true;
  scanStatus.textContent = 'Scanning receipt photo… this can take ~5-20 seconds.';

  try {
    if (!window.Tesseract) {
      scanStatus.textContent = 'OCR unavailable here. Use pasted text fallback.';
      return;
    }

    const result = await window.Tesseract.recognize(imageDataUrl, 'eng', {
      logger: (m) => { if (m?.status === 'recognizing text') scanStatus.textContent = `Scanning receipt photo… ${Math.round((m.progress || 0) * 100)}%`; }
    });

    const rawText = result?.data?.text || '';
    ocrTextInput.value = rawText;
    const guessedMerchant = extractMerchant(rawText);
    if (!merchantInput.value.trim() && guessedMerchant) merchantInput.value = guessedMerchant;

    applyParsedItems(parseReceiptText(rawText), 'photo OCR');
  } catch (error) {
    console.error('OCR scan error', error);
    scanStatus.textContent = 'Scan failed. Try clearer photo or use pasted text/AI parse.';
  } finally {
    scanReceiptButton.disabled = false;
  }
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0];
  if (!file) {
    imageDataUrl = '';
    photoPreview.hidden = true;
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    imageDataUrl = String(reader.result || '');
    photoPreview.src = imageDataUrl;
    photoPreview.hidden = false;
    await scanReceiptWithOcr();
  };
  reader.readAsDataURL(file);
});

parseTextButton.addEventListener('click', () => {
  const text = ocrTextInput.value.trim();
  if (!text) return alert('Paste receipt text first.');
  const guessedMerchant = extractMerchant(text);
  if (!merchantInput.value.trim() && guessedMerchant) merchantInput.value = guessedMerchant;
  applyParsedItems(parseReceiptText(text), 'pasted text');
});

aiParseButton.addEventListener('click', async () => {
  const text = ocrTextInput.value.trim();
  const apiKey = openaiKeyInput.value.trim();
  if (!text) return alert('Scan or paste receipt text first.');
  if (!apiKey) return alert('Enter OpenAI API key first.');

  aiParseButton.disabled = true;
  scanStatus.textContent = 'Asking ChatGPT to extract receipt details…';
  try {
    const ai = await parseWithOpenAI(text, apiKey);
    if (!merchantInput.value.trim() && ai.merchant) merchantInput.value = ai.merchant;
    currentParsedTotals = { subtotal: ai.subtotal, tax: ai.tax, total: ai.total };
    applyParsedItems(ai.items, 'ChatGPT');
  } catch (error) {
    console.error(error);
    scanStatus.textContent = 'AI parse failed. Check key/network and try again.';
  } finally {
    aiParseButton.disabled = false;
  }
});

scanReceiptButton.addEventListener('click', scanReceiptWithOcr);
addItemButton.addEventListener('click', () => addItemRow());

saveReceiptButton.addEventListener('click', () => {
  const merchant = merchantInput.value.trim() || 'Unknown store';
  const purchaseDate = dateInput.value;
  const items = readItemRows();

  if (!purchaseDate) return alert('Please choose a purchase date.');
  if (!items.length) return alert('No items found yet. Scan, parse text, use AI parse, or add manually.');

  const receipt = {
    id: String(Date.now()),
    merchant,
    purchaseDate,
    items,
    total: calculateTotal(items),
    subtotal: currentParsedTotals.subtotal || 0,
    tax: currentParsedTotals.tax || 0,
    receiptTotal: currentParsedTotals.total || 0,
    junkSpend: calculateJunkTotal(items),
    imageDataUrl,
    createdAt: new Date().toISOString()
  };

  receipts.unshift(receipt);
  saveState();
  renderSummary();
  renderReceipts();
  resetForm();
});

(function init() {
  loadState();
  dateInput.valueAsDate = new Date();
  addItemRow();
  renderSummary();
  renderReceipts();
})();
