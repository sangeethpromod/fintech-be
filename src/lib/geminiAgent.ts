import { geminiModel } from '../config/gemini';
import { google } from 'googleapis';

interface ParsedTransaction {
  transaction_id: string;
  transaction_date: string;
  amount: number;
  category: string;
  merchant: string;
  account: string;
  payment_method: string;
  direction: 'Inflow' | 'Outflow';
  created_at: string;
  raw_message: string;
  confidence: number;
}

interface GeminiClassification {
  category: string;
  confidence: number;
  bank: string;
  merchant: string;
}

interface MerchantRule {
  match_pattern: string;
  canonical_merchant: string;
  category: string;
  priority: number;
}

interface MerchantCategoryResolution {
  merchant: string;
  category: string;
  confidence: number;
  source: 'rules' | 'gemini';
}

const ALLOWED_CATEGORIES = [
  'Rent and maintainence',
  'Utilities',
  'Groceries & Home Supplies',
  'Food & Dining',
  'Entertainment, OTT etc',
  'Investements and Stock Purchases',
  'Fashion and Shopping',
  'Fuel',
  'Vehicle Ownership (Tyres, Washing etc)',
  'Health & Medicine Expenses',
  'Transport',
  'Sending money to parents or family',
  'Travel and Vacations',
  'Home Improvement',
  'Helping Others / Donations',
  'Unknown',
  'Credit Card',
  'EMI',
  'Loan Repayment',
] as const;

// In-memory cache for merchant rules
let merchantRulesCache: MerchantRule[] | null = null;
let lastRulesLoadTime: number | null = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Google Sheets configuration
const SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!SHEETS_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
  console.warn('Google Sheets environment variables not configured. Merchant rules will not be loaded.');
}

const auth = SHEETS_ID && CLIENT_EMAIL && PRIVATE_KEY ? new google.auth.GoogleAuth({
  credentials: {
    client_email: CLIENT_EMAIL,
    private_key: PRIVATE_KEY,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
}) : null;

const sheets = auth ? google.sheets({ version: 'v4', auth }) : null;

/**
 * CRITICAL: Single normalization function for ALL matching operations
 * Ensures consistent normalization between raw merchants and rule patterns
 * 
 * Rules:
 * - Convert to uppercase
 * - Keep only A-Z, 0-9, spaces, and @
 * - Collapse multiple spaces to single space
 * - Trim leading/trailing spaces
 */
function normalizeForMatch(input: string): string {
  if (!input) return '';
  
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9@\s]/g, '') // Keep only alphanumeric, @, and spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim(); // Remove leading/trailing spaces
}

/**
 * Load merchant-category rules from Google Sheets
 * Returns cached rules if available and fresh (< 5 minutes old)
 */
async function loadMerchantRules(): Promise<MerchantRule[]> {
  // Return cached rules if still fresh
  const now = Date.now();
  if (merchantRulesCache && lastRulesLoadTime && (now - lastRulesLoadTime < CACHE_DURATION_MS)) {
    return merchantRulesCache;
  }

  // Return empty array if Google Sheets is not configured
  if (!sheets || !SHEETS_ID) {
    console.warn('Google Sheets not configured. Using empty merchant rules.');
    return [];
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_ID,
      range: 'Database!A2:E', // Skip header row, read columns A-E (match_pattern, canonical_merchant, category, priority, notes)
    });

    const rows = response.data.values || [];
    const rules: MerchantRule[] = rows
      .map((row) => {
        const matchPattern = (row[0] || '').toString().trim();
        const canonicalMerchant = (row[1] || '').toString().trim();
        const category = (row[2] || '').toString().trim();
        const priority = parseFloat(row[3]) || 0;

        // Skip invalid rows
        if (!matchPattern || !canonicalMerchant || !category) {
          return null;
        }

        return {
          match_pattern: normalizeForMatch(matchPattern), // CRITICAL: Normalize at load time
          canonical_merchant: canonicalMerchant,
          category: category,
          priority: priority,
        };
      })
      .filter((rule): rule is MerchantRule => rule !== null);

    // Update cache
    merchantRulesCache = rules;
    lastRulesLoadTime = now;

    console.log(`Loaded ${rules.length} merchant rules from Google Sheets`);
    return rules;
  } catch (error) {
    console.error('Failed to load merchant rules from Google Sheets:', error);
    // Return cached rules if available, even if stale
    return merchantRulesCache || [];
  }
}

/**
 * Extract raw merchant name from SMS using deterministic regex patterns
 * This is the FIRST step - extract what's there, don't classify yet
 */
function extractRawMerchant(sms: string): string {
  // Pattern 1: "to MERCHANT.Ref" or "to MERCHANT on"
  const toPattern = /to\s+([A-Za-z0-9\s@.-]+?)(?:\.Ref|\son|\sUPI|\sat)/i;
  let match = sms.match(toPattern);
  if (match && match[1]) {
    return match[1].trim();
  }

  // Pattern 2: UPI ID with @ symbol (e.g., "name@paytm", "phone@bank")
  const upiPattern = /(?:to|from)\s+([a-z0-9._-]+@[a-z0-9.-]+)/i;
  match = sms.match(upiPattern);
  if (match && match[1]) {
    return match[1].trim();
  }

  // Pattern 3: "from MERCHANT" or "From MERCHANT"
  const fromPattern = /from\s+([A-Za-z0-9\s@.-]+?)(?:\sAC|\son|\sUPI|\sat|\.|,)/i;
  match = sms.match(fromPattern);
  if (match && match[1]) {
    return match[1].trim();
  }

  // Pattern 4: After "at" (e.g., "at MERCHANT")
  const atPattern = /at\s+([A-Za-z0-9\s@.-]+?)(?:\.|\ on|\sRef)/i;
  match = sms.match(atPattern);
  if (match && match[1]) {
    return match[1].trim();
  }

  return 'Unknown';
}

/**
 * Resolve merchant and category using the merchant rules table
 * This is the PRIMARY resolution method - uses rules as source of truth
 * 
 * CRITICAL MATCHING LOGIC:
 * - Normalize BOTH rawMerchant and rule.match_pattern using normalizeForMatch()
 * - Use includes() for matching (NEVER ===)
 * - Select highest priority rule if multiple matches
 */
function resolveMerchantAndCategory(
  rawMerchant: string,
  rules: MerchantRule[]
): MerchantCategoryResolution | null {
  if (!rawMerchant || rawMerchant === 'Unknown' || rules.length === 0) {
    return null;
  }

  // CRITICAL: Normalize the raw merchant for matching
  const normalizedRawMerchant = normalizeForMatch(rawMerchant);

  if (!normalizedRawMerchant) {
    return null;
  }

  // Find all matching rules using includes()
  const matchingRules = rules.filter((rule) => {
    // rule.match_pattern is already normalized during loadMerchantRules()
    return normalizedRawMerchant.includes(rule.match_pattern);
  });

  if (matchingRules.length === 0) {
    return null;
  }

  // Select the rule with highest priority (number comparison)
  const selectedRule = matchingRules.reduce((prev, current) =>
    current.priority > prev.priority ? current : prev
  );

  console.log(`✓ Rule matched: "${rawMerchant}" → "${selectedRule.canonical_merchant}" [${selectedRule.category}] (priority: ${selectedRule.priority})`);

  return {
    merchant: selectedRule.canonical_merchant,
    category: selectedRule.category,
    confidence: 0.95, // High confidence for rule-based matches
    source: 'rules',
  };
}

/**
 * Parse transaction SMS and extract all details
 * 
 * Resolution Flow:
 * 1. Extract basic details (amount, date, direction, etc.)
 * 2. Extract raw merchant using deterministic regex
 * 3. Try to resolve via merchant rules table (PRIMARY)
 * 4. If no rule match, fallback to Gemini (SECONDARY)
 * 5. Return complete ParsedTransaction
 */
export async function parseTransactionSMS(message: string): Promise<ParsedTransaction> {
  const sms = message.trim();
  
  // Step 1: Extract basic transaction details
  const amount = extractAmount(sms);
  const direction = extractDirection(sms);
  const transactionId = extractTransactionId(sms);
  const transactionDate = extractTransactionDate(sms);
  const account = extractAccount(sms);
  const paymentMethod = extractPaymentMethod(sms);
  
  // Step 2: Extract raw merchant name using regex (deterministic)
  const rawMerchant = extractRawMerchant(sms);
  
  // Step 3: Load merchant rules and attempt rule-based resolution
  const rules = await loadMerchantRules();
  const ruleResolution = resolveMerchantAndCategory(rawMerchant, rules);
  
  let merchant: string;
  let category: string;
  let confidence: number;
  
  if (ruleResolution) {
    // SUCCESS: Rule matched - use rule data (PRIMARY path)
    merchant = ruleResolution.merchant;
    category = ruleResolution.category;
    confidence = ruleResolution.confidence;
  } else {
    // FALLBACK: No rule matched - use Gemini (SECONDARY path)
    console.log(`✗ No rule matched for "${rawMerchant}" - using Gemini fallback`);
    const geminiData = await classifyTransactionWithGemini(sms, rawMerchant);
    merchant = geminiData.merchant;
    category = geminiData.category;
    confidence = Math.min(geminiData.confidence, 0.7); // Cap Gemini confidence at 0.7
  }
  
  // Step 4: Return complete parsed transaction
  return {
    transaction_id: transactionId,
    transaction_date: transactionDate,
    amount: amount,
    category: category,
    merchant: merchant,
    account: account,
    payment_method: paymentMethod,
    direction: direction,
    created_at: get12HourTime(),
    raw_message: sms,
    confidence: confidence
  };
}

/**
 * Extract amount from SMS
 */
function extractAmount(sms: string): number {
  // Match patterns like: Rs.3, Rs 3, INR 3, ₹3, 3.00, 3,000.00
  const patterns = [
    /(?:Rs\.?|INR|₹)\s*([0-9,]+\.?\d*)/i,
    /([0-9,]+\.?\d*)\s*(?:Rs\.?|INR|₹)/i,
    /(?:credited|debited|paid|sent|received)\s+(?:Rs\.?|INR|₹)?\s*([0-9,]+\.?\d*)/i
  ];
  
  for (const pattern of patterns) {
    const match = sms.match(pattern);
    if (match && match[1]) {
      const amountStr = match[1].replace(/,/g, '');
      return parseFloat(amountStr);
    }
  }
  
  return 0;
}

/**
 * Extract transaction direction (Inflow/Outflow)
 */
function extractDirection(sms: string): 'Inflow' | 'Outflow' {
  const inflowKeywords = ['credited', 'received', 'deposited', 'refund', 'cashback'];
  const outflowKeywords = ['debited', 'paid', 'sent', 'withdrawn', 'purchase', 'spent'];
  
  const lowerSms = sms.toLowerCase();
  
  if (inflowKeywords.some(keyword => lowerSms.includes(keyword))) {
    return 'Inflow';
  }
  
  if (outflowKeywords.some(keyword => lowerSms.includes(keyword))) {
    return 'Outflow';
  }
  
  return 'Outflow'; // Default
}

/**
 * Extract transaction ID
 */
function extractTransactionId(sms: string): string {
  // Match patterns like: XX2411, A/c XX2411, Ref No: 123456, UTR: 123456
  const patterns = [
    /A\/c\s+([A-Z0-9]+)/i,
    /(?:Ref\.?|Reference)\s*(?:No\.?|Number)?\s*:?\s*([A-Z0-9]+)/i,
    /UTR\s*:?\s*([A-Z0-9]+)/i,
    /(?:XX|xxx)(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = sms.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  // Generate random ID if not found
  return 'TXN' + Date.now().toString().slice(-8);
}

/**
 * Extract and format transaction date
 */
function extractTransactionDate(sms: string): string {
  // Match patterns like: 17JAN2026 20:19:52, 20-01-2026 at 16:35:10, on 17 Jan 2026
  const patterns = [
    /(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/i,
    /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\s+(?:at\s+)?(\d{1,2}):(\d{2}):?(\d{2})?/,
    /on\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2}))?/i
  ];
  
  for (const pattern of patterns) {
    const match = sms.match(pattern);
    if (match) {
      return formatTransactionDate(match);
    }
  }
  
  return getReadableDate();
}

/**
 * Format transaction date to human-readable format (e.g., 21 Jan 2026)
 */
function formatTransactionDate(match: RegExpMatchArray): string {
  const monthMap: { [key: string]: string } = {
    '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
    '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
    '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec'
  };
  
  const monthNameMap: { [key: string]: string } = {
    'JAN': 'Jan', 'FEB': 'Feb', 'MAR': 'Mar', 'APR': 'Apr',
    'MAY': 'May', 'JUN': 'Jun', 'JUL': 'Jul', 'AUG': 'Aug',
    'SEP': 'Sep', 'OCT': 'Oct', 'NOV': 'Nov', 'DEC': 'Dec'
  };
  
  // Format: 17JAN2026 20:19:52
  if (match[2] && monthNameMap[match[2].toUpperCase()]) {
    const day = parseInt(match[1] || '1');
    const month = monthNameMap[match[2].toUpperCase()];
    const year = match[3] || new Date().getFullYear().toString();
    
    return `${day} ${month} ${year}`;
  }
  
  // Format: 17-01-2026 20:19:52 or 20-01-2026 at 16:35:10
  if (match[1] && match[2] && match[3]) {
    const day = parseInt(match[1] || '1');
    const monthNum = (match[2] || '01').padStart(2, '0');
    const month = monthMap[monthNum] || 'Jan';
    const year = match[3] || new Date().getFullYear().toString();
    
    return `${day} ${month} ${year}`;
  }
  
  return getReadableDate();
}

/**
 * Extract account/bank name
 */
function extractAccount(sms: string): string {
  // Match patterns like: Federal Bank, HDFC Bank, SBI, ICICI
  const bankPattern = /(Federal Bank|HDFC Bank|ICICI Bank|SBI|State Bank|Axis Bank|Kotak Bank|Yes Bank|IDFC|PNB|Bank of Baroda|Canara Bank)/i;
  const match = sms.match(bankPattern);
  
  if (match) {
    return match[1] || 'Unknown';
  }
  
  return 'Unknown';
}

/**
 * Extract payment method
 */
function extractPaymentMethod(sms: string): string {
  const lowerSms = sms.toLowerCase();
  
  if (lowerSms.includes('upi') || lowerSms.includes('@')) {
    return 'UPI';
  }
  
  if (lowerSms.includes('card') || lowerSms.includes('atm')) {
    return 'Card';
  }
  
  if (lowerSms.includes('net banking') || lowerSms.includes('netbanking')) {
    return 'Net Banking';
  }
  
  if (lowerSms.includes('wallet')) {
    return 'Wallet';
  }
  
  if (lowerSms.includes('cash')) {
    return 'Cash';
  }
  
  return 'UPI'; // Default
}

/**
 * Get current date in readable format (e.g., 21 Jan 2026)
 */
function getReadableDate(): string {
  const now = new Date();
  const day = now.getDate();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear();
  
  return `${day} ${month} ${year}`;
}

/**
 * Get current time in 12-hour format (e.g., 1:13pm)
 */
function get12HourTime(): string {
  const now = new Date();
  let hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  
  return `${hours}:${minutes.toString().padStart(2, '0')}${ampm}`;
}

/**
 * Use Gemini AI as FALLBACK ONLY when merchant rules don't match
 * Gemini should focus on category classification, not merchant extraction
 */
async function classifyTransactionWithGemini(
  sms: string,
  rawMerchant: string
): Promise<GeminiClassification> {
  try {
    const prompt = `Parse this Indian bank SMS and classify the transaction category.

SMS: "${sms}"
Extracted Merchant: "${rawMerchant}"

Your task:
1. Classify into ONE category from: [${ALLOWED_CATEGORIES.join(', ')}]
2. Provide confidence score (0.0 to 1.0)
3. Keep the extracted merchant as-is or refine it slightly if needed

Return JSON with:
{
  "category": "<category_name>",
  "confidence": <0.0-1.0>,
  "merchant": "<merchant_name>"
}

Examples:
SMS: "Rs 29.00 sent via UPI to SWIGGY"
Merchant: "SWIGGY"
Answer: {"category":"Food & Dining","confidence":0.85,"merchant":"SWIGGY"}

SMS: "Rs 500 paid to AMAZONPAY"
Merchant: "AMAZONPAY"
Answer: {"category":"Fashion and Shopping","confidence":0.75,"merchant":"AMAZON PAY"}

Now classify the above SMS. Return ONLY JSON, no explanation:`;

    const result = await geminiModel.generateContent(prompt);
    const response = result.response;
    const text = response.text().trim();

    // Remove markdown code blocks if present
    const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanText) as { category: string; confidence: number; merchant: string };

    // Validate category
    if (!ALLOWED_CATEGORIES.includes(parsed.category as any)) {
      parsed.category = 'Unknown';
      parsed.confidence = 0;
    }

    // Validate confidence
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      parsed.confidence = 0;
    }

    return {
      category: parsed.category,
      confidence: parsed.confidence,
      bank: 'Unknown', // Bank extraction handled separately
      merchant: parsed.merchant || rawMerchant || 'Unknown'
    };
  } catch (error) {
    console.error('Gemini classification error:', error);
    return {
      category: 'Unknown',
      confidence: 0,
      bank: 'Unknown',
      merchant: rawMerchant || 'Unknown'
    };
  }
}

// Export for use in your application
export { ParsedTransaction, GeminiClassification };