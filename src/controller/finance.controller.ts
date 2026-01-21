import { FastifyRequest, FastifyReply } from 'fastify';
import { parseTransactionSMS } from '../lib/geminiAgent';
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

    // Parse SMS and classify with Gemini
    let parsedTransaction;
    try {
      parsedTransaction = await parseTransactionSMS(message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Transaction parsing failed';
      request.log.error({ error: errorMessage }, 'transaction_parse_failed');
      return reply.status(400).send({ error: errorMessage });
    }

    // Write to Google Sheets
    try {
      await appendTransactionToSheet(parsedTransaction, parsedTransaction.category);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to write to sheets';
      request.log.error({ transaction_id: parsedTransaction.transaction_id, error: errorMessage }, 'sheets_write_failed');
      return reply.status(500).send({ error: errorMessage });
    }

    // Return response
    request.log.info({ transaction_id: parsedTransaction.transaction_id, category: parsedTransaction.category }, 'transaction_ingested');
    return reply.status(200).send(parsedTransaction);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unexpected error';
    request.log.error({ error: errorMessage }, 'unexpected_error');
    return reply.status(500).send({ error: errorMessage });
  }
}
