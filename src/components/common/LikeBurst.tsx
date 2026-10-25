import React,{useEffect,useRef,useState} from 'react';
import './like-burst.css';

/** Little hearts fly out of a like button the moment a track becomes liked (never on unlike or on first render). */
export function LikeBurst({liked}:{liked:boolean}){
  const [burst,setBurst]=useState(0),previous=useRef(liked);
  useEffect(()=>{if(liked&&!previous.current)setBurst(n=>n+1);previous.current=liked;},[liked]);
  if(!burst)return null;
  return <span className="like-burst" key={burst} aria-hidden="true">{Array.from({length:7},(_,i)=><i key={i} style={{'--a':`${i*360/7-90}deg`,'--d':`${18+(i%3)*5}px`} as React.CSSProperties}>♥</i>)}</span>;
}
