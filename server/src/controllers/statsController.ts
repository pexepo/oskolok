import {Router} from 'express';
import {z} from 'zod';
import {listeningStats} from '../services/listeningStats.js';

/** «Итоги»: the listener's own listening statistics. */
export const statsRoutes=Router();
statsRoutes.get('/me/stats',(req,res,next)=>{
  const q=z.object({period:z.enum(['week','month','year','all']).default('month'),tz:z.coerce.number().int().min(-840).max(840).default(0)}).safeParse(req.query);
  if(!q.success){res.status(400).json({error:{code:'BAD_PERIOD',message:'Неизвестный период.'}});return;}
  res.setHeader('Cache-Control','no-store');
  listeningStats(String(res.locals.userId),q.data.period,q.data.tz).then(data=>res.json({data})).catch(next);
});
