import { geminiModel } from '../config/gemini';

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

/**
 * Parse transaction SMS and extract all details
 */
export async function parseTransactionSMS(message: string): Promise<ParsedTransaction> {
  const sms = message.trim();
  
  // Extract basic details
  const amount = extractAmount(sms);
  const direction = extractDirection(sms);
  const transactionId = extractTransactionId(sms);
  const transactionDate = extractTransactionDate(sms);
  const account = extractAccount(sms);
  const paymentMethod = extractPaymentMethod(sms);
  
  // Use Gemini to classify and extract merchant/bank
  const geminiData = await classifyTransaction(sms, amount, paymentMethod, direction);
  
  return {
    transaction_id: transactionId,
    transaction_date: transactionDate,
    amount: amount,
    category: geminiData.category,
    merchant: geminiData.merchant,
    account: geminiData.bank !== 'Unknown' ? geminiData.bank : account,
    payment_method: paymentMethod,
    direction: direction,
    created_at: get12HourTime(),
    raw_message: sms,
    confidence: geminiData.confidence
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
 * Use Gemini AI to classify transaction and extract merchant
 */
async function classifyTransaction(
  sms: string,
  amount: number,
  paymentMethod: string,
  direction: string
): Promise<GeminiClassification> {
  try {
    const prompt = `Parse this Indian bank SMS and extract data in JSON format.

SMS: "${sms}"

Extract:
1. bank: The bank that sent this SMS (look for bank names like "Federal Bank", "HDFC Bank", "Kotak Bank", "SBI", "ICICI", "Axis Bank" - usually at end of SMS or after "from")
2. merchant: The recipient or sender of money:
   - After "to " before ".Ref" or "on" (e.g., "to AD VENTURES.Ref" → "AD VENTURES")
   - UPI IDs with @ symbol (e.g., "aftab.mehrab@oksbi", "name@paytm")
   - After "To " or "from " in the SMS
   - NOT the bank name, NOT phone numbers, NOT URLs
3. category: One of [${ALLOWED_CATEGORIES.join(', ')}]
4. confidence: 0.0 to 1.0

For SMS: "Rs 29.00 sent via UPI on 20-01-2026 at 16:35:10 to AD VENTURES.Ref:163509601488.Not you? Call 18004251199/SMS BLOCKUPI to 98950 88888 -Federal Bank"
Answer: {"category":"Unknown","confidence":0.85,"bank":"Federal Bank","merchant":"AD VENTURES"}

For SMS: "Sent Rs.8000.00 from Kotak Bank AC X9959 to aftab.mehrab@oksbi on 20-01-26.UPI Ref 638699419156"
Answer: {"category":"Sending money to parents or family","confidence":0.7,"bank":"Kotak Bank","merchant":"aftab.mehrab@oksbi"}

Now parse the SMS above. Return ONLY JSON, no explanation:`;

    const result = await geminiModel.generateContent(prompt);
    const response = result.response;
    const text = response.text().trim();

    // Remove markdown code blocks if present
    const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanText) as GeminiClassification;

    // Validate category
    if (!ALLOWED_CATEGORIES.includes(parsed.category as any)) {
      parsed.category = 'geminiMnknown';
      parsed.confidence = 0;
    }

    // Validate confidence
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      parsed.confidence = 0;
    }

    return {
      category: parsed.category,
      confidence: parsed.confidence,
      bank: parsed.bank || 'Unknown',
      merchant: parsed.merchant || 'Unknown'
    };
  } catch (error) {
    console.error('Gemini classification error:', error);
    return {
      category: 'Unknown',
      confidence: 0,
      bank: 'Unknown',
      merchant: 'Unknown'
    };
  }
}

// Export for use in your application
export { ParsedTransaction, GeminiClassification };