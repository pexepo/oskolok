import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

export const prisma = new PrismaClient();

prisma.$connect()
  .then(() => {
    logger.info('Successfully connected to SQLite database via Prisma');
  })
  .catch((err) => {
    logger.error({ err }, 'Failed to connect to database');
  });
