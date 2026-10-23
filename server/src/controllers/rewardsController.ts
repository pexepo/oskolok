import {Router} from 'express';
import {ownRewards,markRewardsSeen} from '../services/rewards.js';

/** Own rewards: GET /api/profile/achievements (all achievements with progress, medals, unseen unlocks); POST …/seen. */
export const rewardRoutes=Router();
const route=(fn:(req:any,res:any)=>Promise<void>)=>async(req:any,res:any,next:any)=>{try{await fn(req,res);}catch(e){next(e);}};
rewardRoutes.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
rewardRoutes.get('/',route(async(_req,res)=>{res.json({data:await ownRewards(res.locals.userId)});}));
rewardRoutes.post('/seen',route(async(_req,res)=>{await markRewardsSeen(res.locals.userId);res.json({data:{ok:true}});}));
