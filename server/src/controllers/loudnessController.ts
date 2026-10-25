import type {Request,Response,NextFunction} from 'express';
import {studioMasterService} from '../services/StudioMasterService.js';
import {cachedLoudness} from '../services/LoudnessService.js';
import {mixAnalysisFor} from '../services/mixAnalysis.js';
export async function loudnessController(req:Request,res:Response,next:NextFunction) {
  try {
    const file=studioMasterService.getExportAudio(req.params.id);
    const result=file?await cachedLoudness(file.path):null;
    res.json({data:result?{status:'ready',...result}:{status:'pending',gainDb:-6}});
  }catch(error){next(error);}
}
/** «ИИ-микс»: tempo, beat grid, intro and outro of a cached track; pending until its audio is cached. */
export async function mixAnalysisController(req:Request,res:Response,next:NextFunction) {
  try {
    const result=await mixAnalysisFor(req.params.id,()=>studioMasterService.getExportAudio(req.params.id)?.path??null).catch(()=>null);
    res.setHeader('Cache-Control',result?'private, max-age=86400':'no-store');
    res.json({data:result?{status:'ready',...result}:{status:'pending'}});
  }catch(error){next(error);}
}
