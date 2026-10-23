import type {Request,Response,NextFunction} from 'express';
import {studioMasterService} from '../services/StudioMasterService.js';
import {cachedLoudness} from '../services/LoudnessService.js';
export async function loudnessController(req:Request,res:Response,next:NextFunction) {
  try {
    const file=studioMasterService.getExportAudio(req.params.id);
    const result=file?await cachedLoudness(file.path):null;
    res.json({data:result?{status:'ready',...result}:{status:'pending',gainDb:-6}});
  }catch(error){next(error);}
}
