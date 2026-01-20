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
    let parsedTransaction;
    try {
      parsedTransaction = parseSMS(message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'SMS parsing failed';
      request.log.error({ error: errorMessage }, 'sms_parse_failed');
      return reply.status(400).send({ error: errorMessage });
    }

    // Step 2: Classify with Gemini
    let classification;
    try {
      classification = await classifyTransaction(parsedTransaction);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Gemini classification failed';
      request.log.error({ transaction_id: parsedTransaction.transaction_id, error: errorMessage }, 'gemini_classification_failed');
      return reply.status(500).send({ error: errorMessage });
    }

    // Step 3: Write to Google Sheets
    try {
      await appendTransactionToSheet(parsedTransaction, classification.category);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to write to sheets';
      request.log.error({ transaction_id: parsedTransaction.transaction_id, error: errorMessage }, 'sheets_write_failed');
      return reply.status(500).send({ error: errorMessage });
    }

    // Step 4: Return response
    request.log.info({ transaction_id: parsedTransaction.transaction_id, category: classification.category }, 'transaction_ingested');
    return reply.status(200).send({
      ...parsedTransaction,
      category: classification.category,
      confidence: classification.confidence,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unexpected error';
    request.log.error({ error: errorMessage }, 'unexpected_error');
    return reply.status(500).send({ error: errorMessage });
  }
}
