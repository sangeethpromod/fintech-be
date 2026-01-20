import { FastifyPluginAsync } from 'fastify';
import { newTransactionHandler } from '../controller/finance.controller';

const ingestRoute: FastifyPluginAsync = async (fastify, opts) => {
  fastify.post('/finance/new-transaction', newTransactionHandler);
};

export default ingestRoute;