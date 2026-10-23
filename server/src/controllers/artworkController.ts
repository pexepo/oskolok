import type {Request,Response} from 'express';
import {ArtworkError,cachedArtwork} from '../services/ArtworkService.js';
export async function artworkController(req:Request,res:Response){
  try{
    const value=req.query.url;
    if(typeof value!=='string'){res.status(400).end();return;}
    const image=await cachedArtwork(value);
    res.setHeader('Cache-Control','public, max-age=2592000, immutable');
    res.setHeader('X-Content-Type-Options','nosniff');
    const extension=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif','image/gif':'gif' } as Record<string,string>)[image.type]||'jpg';
    res.setHeader('Content-Disposition',`inline; filename="oskolok-artwork.${extension}"`);
    res.type(image.type).send(image.data);
  }catch(error){res.status(error instanceof ArtworkError?error.status:502).end();}
}
