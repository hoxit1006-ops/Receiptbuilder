const STORAGE_KEY = 'receipt_spending_tracker_v5';
const OLLAMA_MODEL_STORAGE = 'receipt_tracker_ollama_model';
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
const ollamaModelInput = document.getElementById('ollamaModel');
const parseTextButton = document.getElementById('parseText');
const aiParseButton = document.getElementById('aiParse');
const scanReceiptButton = document.getElementById('scanReceipt');
const scanStatus = document.getElementById('scanStatus');
const itemsContainer = document.getElementById('items');
const addItemButton = document.getElementById('addItem');
const saveReceiptButton = document.getElementById('saveReceipt');
const totalSpentEl = document.getElementById('totalSpent');
const junkSavingsEl = document.getElementById('junkSavings');
const categorySummaryEl = document.getElementById('categorySummary');
const receiptListEl = document.getElementById('receiptList');

let receipts = [];
let imageDataUrl = '';

function createEmptyItem(item = {}) {
  return {
    name: item.name || '',
    price: item.price ? String(item.price) : '',
    quantity: item.quantity ? String(item.quantity) : '1',
    category: item.category || 'Other'
  };
}

function guessCategory(name) {
  const lower = name.toLowerCase();
  const matched = Object.entries(CATEGORY_KEYWORDS).find(([, keywords]) => keywords.some((keyword) => lower.includes(keyword)));
  return matched ? matched[0] : 'Other';
}

function cleanupLine(line) {
  return line
    .replace(/[|]/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMerchant(text) {
  const lines = text
    .split(/\r?\n/)
    .map(cleanupLine)
    .filter(Boolean)
    .slice(0, 6);
  const candidate = lines.find((line) => /[A-Za-z]{3,}/.test(line) && !/receipt|invoice|thank|date|time/i.test(line));
  return candidate || '';
}

function parseReceiptText(text) {
  const lines = text.split(/\r?\n/).map(cleanupLine).filter(Boolean);
  const skipPattern = /subtotal|tax|total|balance|change|visa|mastercard|debit|credit|cash|thank|invoice|order|auth|payment/i;

  const parsedItems = [];
  const seen = new Set();

  for (const line of lines) {
    if (skipPattern.test(line)) continue;

    const tokens = line.match(/\d{1,4}[\.,]\d{2}/g) || [];
    if (!tokens.length) continue;

    const lastToken = tokens[tokens.length - 1];
    const price = Number(lastToken.replace(',', '.'));
    if (!Number.isFinite(price) || price <= 0 || price > 9999) continue;

    let quantity = 1;
    const qtyMatch = line.match(/(?:^|\s)(\d+)\s*[xX](?:\s|$)/);
    if (qtyMatch) quantity = Math.max(1, Number(qtyMatch[1]));

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

  return parsedItems;
}

function normalizeAiItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const name = String(item?.name || '').trim();
      const price = Number(item?.price || 0);
      const quantity = Math.max(1, Number(item?.quantity || 1));
      let category = String(item?.category || '').trim();
      if (!CATEGORIES.includes(category)) category = guessCategory(name);
      return { name, price, quantity, category };
    })
    .filter((item) => item.name && Number.isFinite(item.price) && item.price > 0);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return safeJsonParse(text.slice(start, end + 1));
}

async function parseWithOllama(rawText) {
  const model = ollamaModelInput.value.trim() || 'llama3.1:8b';
  localStorage.setItem(OLLAMA_MODEL_STORAGE, model);

  const prompt = `Extract receipt data and return STRICT JSON only with shape:
{
  "merchant": string,
  "items": [{"name": string, "price": number, "quantity": number, "category": one of ${CATEGORIES.join(', ')} }]
}
Rules:
- Include line items only.
- Ignore subtotal/tax/total/payment lines.
- Infer category if missing.
- quantity=1 when unknown.
Receipt text:\n${rawText}`;

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0 }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const outputText = payload?.response || '';
  const parsed = safeJsonParse(outputText) || extractJsonObject(outputText);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Ollama response did not return valid JSON.');
  }

  return {
    merchant: String(parsed.merchant || '').trim(),
    items: normalizeAiItems(parsed.items)
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
        price: Number(price.value || 0),
        quantity: Number(quantity.value || 1),
        category: category.value || 'Other'
      };
    })
    .filter((item) => item.name && item.price > 0 && item.quantity > 0);
}

function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function calculateJunkTotal(items) {
  return items.filter((item) => JUNK_CATEGORIES.has(item.category)).reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(receipts));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  receipts = raw ? JSON.parse(raw) : [];
}

function renderSummary() {
  const total = receipts.reduce((sum, receipt) => sum + receipt.total, 0);
  const junkTotal = receipts.reduce((sum, receipt) => sum + (receipt.junkSpend || 0), 0);

  totalSpentEl.textContent = `$${total.toFixed(2)}`;
  junkSavingsEl.textContent = `Potential savings (skip junk food): $${junkTotal.toFixed(2)}`;

  const byCategory = {};
  receipts.forEach((receipt) => {
    receipt.items.forEach((item) => {
      byCategory[item.category] = (byCategory[item.category] || 0) + item.price * item.quantity;
    });
  });

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


function deleteReceipt(receiptId) {
  receipts = receipts.filter((receipt) => receipt.id !== receiptId);
  saveState();
  renderSummary();
  renderReceipts();
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
      <div class="small">Total spent: $${receipt.total.toFixed(2)}</div>
      <div class="small">Possible junk-food savings: $${(receipt.junkSpend || 0).toFixed(2)}</div>
      <div class="small" style="margin-top: 8px;">${itemsHtml}</div>
      ${receipt.imageDataUrl ? `<img class="thumb" src="${receipt.imageDataUrl}" alt="${receipt.merchant} receipt" />` : ''}
      <button class="btn-danger receipt-delete" data-receipt-id="${receipt.id}" type="button">Delete receipt</button>
    `;

    const deleteButton = card.querySelector('.receipt-delete');
    deleteButton?.addEventListener('click', () => {
      const confirmed = window.confirm('Delete this receipt from history?');
      if (confirmed) deleteReceipt(receipt.id);
    });

    receiptListEl.appendChild(card);
  });
}

function resetForm() {
  merchantInput.value = '';
  dateInput.valueAsDate = new Date();
  photoInput.value = '';
  ocrTextInput.value = '';
  imageDataUrl = '';
  photoPreview.hidden = true;
  photoPreview.removeAttribute('src');
  scanStatus.textContent = '';
  itemsContainer.innerHTML = '';
  addItemRow();
}

function applyParsedItems(parsedItems, source = 'scan') {
  if (!parsedItems.length) {
    scanStatus.textContent = `Could not parse items from ${source}. Add or edit items manually.`;
    if (!itemsContainer.children.length) addItemRow();
    return;
  }

  setItemRows(parsedItems);
  scanStatus.textContent = `Parsed ${parsedItems.length} item(s) from ${source}. Review before saving.`;
}

async function scanReceiptWithOcr() {
  if (!imageDataUrl) {
    alert('Please take/upload a receipt photo first.');
    return;
  }

  scanReceiptButton.disabled = true;
  scanStatus.textContent = 'Scanning receipt photo… this can take ~5-20 seconds.';

  try {
    if (!window.Tesseract) {
      scanStatus.textContent = 'OCR library unavailable. Use pasted text or Ollama parse fallback.';
      return;
    }

    const result = await window.Tesseract.recognize(imageDataUrl, 'eng', {
      logger: (m) => {
        if (m?.status === 'recognizing text') scanStatus.textContent = `Scanning receipt photo… ${Math.round((m.progress || 0) * 100)}%`;
      }
    });

    const rawText = result?.data?.text || '';
    ocrTextInput.value = rawText;

    const guessedMerchant = extractMerchant(rawText);
    if (!merchantInput.value.trim() && guessedMerchant) merchantInput.value = guessedMerchant;

    applyParsedItems(parseReceiptText(rawText), 'photo OCR');
  } catch (error) {
    console.error('OCR scan error', error);
    scanStatus.textContent = 'Scan failed. Try clearer photo or use AI parse with Ollama.';
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
  if (!text) return alert('Paste OCR text first (or scan photo first).');

  aiParseButton.disabled = true;
  scanStatus.textContent = 'Sending receipt text to Ollama for better extraction…';

  try {
    const ai = await parseWithOllama(text);

    if (!merchantInput.value.trim() && ai.merchant) merchantInput.value = ai.merchant;
    if (ai.items.length) {
      applyParsedItems(ai.items, 'Ollama AI parse');
    } else {
      scanStatus.textContent = 'Ollama parse returned no items. Keeping current rows so you can edit manually.';
    }
  } catch (error) {
    console.error(error);
    scanStatus.textContent = `Ollama parse failed: ${error.message}`;
  } finally {
    aiParseButton.disabled = false;
  }
});

ollamaModelInput.addEventListener('change', () => {
  if (ollamaModelInput.value.trim()) localStorage.setItem(OLLAMA_MODEL_STORAGE, ollamaModelInput.value.trim());
});

scanReceiptButton.addEventListener('click', scanReceiptWithOcr);
addItemButton.addEventListener('click', () => addItemRow());

saveReceiptButton.addEventListener('click', () => {
  const merchant = merchantInput.value.trim() || 'Unknown store';
  const purchaseDate = dateInput.value;
  const items = readItemRows();

  if (!purchaseDate) return alert('Please choose a purchase date.');
  if (!items.length) return alert('No items found yet. Scan photo, parse text, or use Ollama parse.');

  const receipt = {
    id: String(Date.now()),
    merchant,
    purchaseDate,
    items,
    total: calculateTotal(items),
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
  ollamaModelInput.value = localStorage.getItem(OLLAMA_MODEL_STORAGE) || 'llama3.1:8b';
})();
