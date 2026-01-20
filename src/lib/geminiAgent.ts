import { genAI } from '../config/gemini';
import { ParsedTransaction } from './smsParser';

interface GeminiClassification {
  category: string;
  confidence: number;
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
  "Loan Repayment",
] as const;

export async function classifyTransaction(
  transaction: ParsedTransaction
): Promise<GeminiClassification> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = `Classify the following transaction into ONE of these categories ONLY: ${ALLOWED_CATEGORIES.join(', ')}.
Also provide a confidence score between 0.0 and 1.0.

Transaction details:
- Merchant: ${transaction.merchant || 'Unknown'}
- Amount: ${transaction.amount}
- Payment Method: ${transaction.payment_method}
- Direction: ${transaction.direction}

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{"category": "CategoryName", "confidence": 0.95}`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text().trim();

    // Remove markdown code blocks if present
    const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    const parsed = JSON.parse(cleanText) as GeminiClassification;

    // Validate category
    if (!ALLOWED_CATEGORIES.includes(parsed.category as any)) {
      return { category: 'Unknown', confidence: 0 };
    }

    // Validate confidence
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      return { category: parsed.category, confidence: 0 };
    }

    return parsed;
  } catch (error) {
    return { category: 'Unknown', confidence: 0 };
  }
}
