import { Request, Response } from 'express';
import { prisma } from '../database/client.js';
import { soundCloudService } from '../services/SoundCloudService.js';

export class HealthController {
  public getHealth = async (req: Request, res: Response): Promise<void> => {
    let dbStatus = 'ok';
    let scStatus = 'not_configured';

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    if (soundCloudService.isConfigured()) {
      scStatus = 'ok';
    }

    const overallStatus = dbStatus === 'ok' ? 'ok' : 'degraded';

    res.json({
      status: overallStatus,
      database: dbStatus,
      soundcloud: scStatus,
      timestamp: new Date().toISOString(),
    });
  };
}

export const healthController = new HealthController();
