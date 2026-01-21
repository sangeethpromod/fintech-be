// export interface ParsedTransaction {
//   transaction_id: string;
//   transaction_date: string;
//   amount: number;
//   category: string;
//   merchant: string;
//   account: string;
//   payment_method: 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'ATM' | 'POS' | 'Bank Transfer' | 'Visa';
//   direction: 'Inflow' | 'Outflow';
//   created_at: string;
//   raw_message: string;
// }

// export function parseSMS(message: string): ParsedTransaction {
//   const normalizedMessage = message.trim();

//   // Extract amount
//   const amountMatch = normalizedMessage.match(/(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.[0-9]{2})?)/i);
//   if (!amountMatch || !amountMatch[1]) {
//     throw new Error('Amount not found in SMS');
//   }
//   const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

//   // Extract direction (debit/credit)
//   let direction: 'Inflow' | 'Outflow';
//   if (/debited|debit|dr|spent|paid|withdrawn|sent/i.test(normalizedMessage)) {
//     direction = 'Outflow';
//   } else if (/credited|credit|cr|received|deposited/i.test(normalizedMessage)) {
//     direction = 'Inflow';
//   } else {
//     throw new Error('Transaction direction not found');
//   }

//   // Extract payment mode
//   let payment_method: 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'ATM' | 'POS' | 'Bank Transfer' | 'Visa';
//   if (/\bUPI\b/i.test(normalizedMessage)) {
//     payment_method = 'UPI';
//   } else if (/\bIMPS\b/i.test(normalizedMessage)) {
//     payment_method = 'IMPS';
//   } else if (/\bNEFT\b/i.test(normalizedMessage)) {
//     payment_method = 'NEFT';
//   } else if (/\bRTGS\b/i.test(normalizedMessage)) {
//     payment_method = 'RTGS';
//   } else if (/\bATM\b/i.test(normalizedMessage)) {
//     payment_method = 'ATM';
//   } else if (/\bPOS\b/i.test(normalizedMessage)) {
//     payment_method = 'POS';
//   } else {
//     payment_method = 'UPI'; // Default fallback
//   }

//   // Extract transaction ID (prioritize explicit refs, fallback to A/c numbers)
//   let transaction_id = '';
//   const txnIdMatch = normalizedMessage.match(/(?:txn|transaction|ref|utr|rrn)[\s:]*([a-z0-9]+)/i);
//   const acctMatch = normalizedMessage.match(/A\/c\s+([A-Z0-9*]+)/i);
  
//   if (txnIdMatch?.[1]) {
//     transaction_id = txnIdMatch[1];
//   } else if (acctMatch?.[1]) {
//     transaction_id = acctMatch[1];
//   }

//   // Merchant and account will be extracted by Gemini for better accuracy
//   const merchant = '';
//   const account = '';

//   // Extract date (multiple formats)
//   let dateStr = '';
//   const dateMatch1 = normalizedMessage.match(/(\d{2})-(\d{2})-(\d{4})/); // DD-MM-YYYY
//   const dateMatch2 = normalizedMessage.match(/(\d{4})-(\d{2})-(\d{2})/); // YYYY-MM-DD
//   const dateMatch3 = normalizedMessage.match(/(\d{2})\/(\d{2})\/(\d{4})/); // DD/MM/YYYY
//   const dateMatch4 = normalizedMessage.match(/(\d{2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
//   const dateMatch5 = normalizedMessage.match(/(\d{2})\/(\d{2})\/(\d{2})\b/); // DD/MM/YY
//   const dateMatch6 = normalizedMessage.match(/(\d{2})-(\d{2})-(\d{2})\b/); // DD-MM-YY
//   const dateMatch7 = normalizedMessage.match(/(\d{2})(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d{4})/i); // DDMMMYYYY

//   const monthMap: { [key: string]: string } = {
//     jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
//     jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
//   };

//   if (dateMatch1) {
//     dateStr = `${dateMatch1[3]}-${dateMatch1[2]}-${dateMatch1[1]}`;
//   } else if (dateMatch2) {
//     dateStr = dateMatch2[0];
//   } else if (dateMatch3) {
//     dateStr = `${dateMatch3[3]}-${dateMatch3[2]}-${dateMatch3[1]}`;
//   } else if (dateMatch4 && dateMatch4[1] && dateMatch4[2] && dateMatch4[3]) {
//     const month = monthMap[dateMatch4[2].toLowerCase().substring(0, 3)];
//     dateStr = `${dateMatch4[3]}-${month}-${dateMatch4[1]}`;
//   } else if (dateMatch5) {
//     // Handle 2-digit year (assume 20xx)
//     const year = `20${dateMatch5[3]}`;
//     dateStr = `${year}-${dateMatch5[2]}-${dateMatch5[1]}`;
//   } else if (dateMatch6) {
//     // Handle 2-digit year (assume 20xx)
//     const year = `20${dateMatch6[3]}`;
//     dateStr = `${year}-${dateMatch6[2]}-${dateMatch6[1]}`;
//   } else if (dateMatch7) {
//     // Handle DDMMMYYYY format like 17JAN2026
//     const month = monthMap[dateMatch7[2].toLowerCase().substring(0, 3)];
//     dateStr = `${dateMatch7[3]}-${month}-${dateMatch7[1]}`;
//   } else {
//     throw new Error('Date not found in SMS');
//   }

//   // Extract time
//   const timeMatch = normalizedMessage.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
//   const timeStr = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3] || '00'}` : '00:00:00';

//   // Combine date and time
//   const transaction_date = `${dateStr} ${timeStr}`;

//   // Created at timestamp in human-readable format
//   const now = new Date();
//   const year = now.getFullYear();
//   const month = String(now.getMonth() + 1).padStart(2, '0');
//   const day = String(now.getDate()).padStart(2, '0');
//   const hours = String(now.getHours()).padStart(2, '0');
//   const minutes = String(now.getMinutes()).padStart(2, '0');
//   const seconds = String(now.getSeconds()).padStart(2, '0');
//   const created_at = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

//   return {
//     transaction_id,
//     transaction_date,
//     amount,
//     category: '',
//     merchant,
//     account,
//     payment_method,
//     direction,
//     created_at,
//     raw_message: normalizedMessage
//   };
// }
