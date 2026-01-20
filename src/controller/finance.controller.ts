import { FastifyRequest, FastifyReply } from 'fastify';
import { parseSMS } from '../lib/smsParser';
import { classifyTransaction } from '../lib/geminiAgent';
import { appendTransactionToSheet } from '../lib/sheets';

interface TransactionRequest {
  message: string;
}

export async function newTransactionHandler(
  request: FastifyRequest<{ Body: TransactionRequest }>,
  reply: FastifyReply
) {
  try {
    const { message } = request.body;

    if (!message) {
      return reply.status(400).send({ error: 'Message is required' });
    }

    // Step 1: Parse SMS
    const parsedTransaction = parseSMS(message);

    // Step 2: Classify with Gemini
    const classification = await classifyTransaction(parsedTransaction);

    // Step 3: Write to Google Sheets
    try {
      await appendTransactionToSheet(parsedTransaction, classification.category);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to write to sheets';
      return reply.status(500).send({ error: errorMessage });
    }

    // Step 4: Return response
    return reply.status(200).send({
      ...parsedTransaction,
      category: classification.category,
      confidence: classification.confidence,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Parsing failed';
    return reply.status(400).send({ error: errorMessage });
  }
}
