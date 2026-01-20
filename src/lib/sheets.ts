import { google } from 'googleapis';
import { ParsedTransaction } from './smsParser';

const SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!SHEETS_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
  throw new Error('Missing required Google Sheets environment variables');
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: CLIENT_EMAIL,
    private_key: PRIVATE_KEY,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

export async function appendTransactionToSheet(
  transaction: ParsedTransaction,
  category: string
): Promise<void> {
  // Map your data to match the exact column order in your sheet
  const row = [
    transaction.transaction_id,      // Column A: transaction_id
    transaction.transaction_date,    // Column B: transaction_date
    transaction.amount,               // Column C: amount
    category,                         // Column D: category
    transaction.merchant,             // Column E: merchant
    transaction.account,              // Column F: account
    transaction.payment_method,       // Column G: payment_method
    transaction.direction,            // Column H: direction
    transaction.created_at,           // Column I: created_at
  ];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEETS_ID,
      range: 'Monthly Spending!A:I', // Changed to your actual sheet name
      valueInputOption: 'USER_ENTERED', // Changed from RAW to handle dates/numbers better
      insertDataOption: 'INSERT_ROWS', // Ensures new rows are inserted
      requestBody: {
        values: [row],
      },
    });
    
  } catch (error) {
    throw new Error(`Failed to write to Google Sheets: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}