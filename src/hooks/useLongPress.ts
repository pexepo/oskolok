import React from 'react';
export type PressPoint={x:number;y:number};
type Options={delay?:number;tolerance?:number;exclude?:string};
type HapticApp={initData?:string;isVersionAtLeast?(version:string):boolean;HapticFeedback?:{impactOccurred(style:'light'|'medium'|'heavy'):void}};
/** Confirms a recognised hold: Telegram's native haptics inside the Mini App (iOS webviews have no Vibration API), navigator.vibrate elsewhere. */
export function pressHaptic(){try{const app=window.Telegram?.WebApp as HapticApp|undefined;if(app?.initData&&app.HapticFeedback&&app.isVersionAtLeast?.('6.1')!==false){app.HapticFeedback.impactOccurred('medium');return;}navigator.vibrate?.(12);}catch{/* Haptics are decorative. */}}
/** Long-press on a container: fires after `delay` ms of a still primary press anywhere inside it (buttons included, only `exclude` targets such as sliders are skipped), also fires on the platform `contextmenu` (right-click, Android's native long-press), cancels on move > `tolerance` px and suppresses the click/touch-compat events that follow a fired press so the pressed button does not also activate. */
export function useLongPress(onLongPress:(point:PressPoint)=>void,{delay=480,tolerance=8,exclude='input,select,textarea'}:Options={}){
 const [press,setPress]=React.useState<PressPoint&{rx:number;ry:number}|null>(null),timer=React.useRef<ReturnType<typeof setTimeout>>(),start=React.useRef<PressPoint|null>(null),fired=React.useRef(false),pointerType=React.useRef(''),callback=React.useRef(onLongPress);callback.current=onLongPress;
 const cancel=React.useCallback(()=>{clearTimeout(timer.current);timer.current=undefined;start.current=null;setPress(null);},[]);
 const fire=React.useCallback((point:PressPoint)=>{cancel();fired.current=true;pressHaptic();callback.current(point);},[cancel]);
 React.useEffect(()=>{const visibility=()=>{if(document.hidden)cancel();};window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',visibility);return()=>{cancel();window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',visibility);};},[cancel]);
 const inside=(event:React.SyntheticEvent)=>event.currentTarget.contains(event.target as Node);
 const excluded=(event:React.SyntheticEvent)=>{const hit=exclude?(event.target as Element).closest?.(exclude):null;return !!hit&&hit!==event.currentTarget;};
 return {press,cancel,handlers:{
  onPointerDown:(event:React.PointerEvent<HTMLElement>)=>{if(!inside(event))return;fired.current=false;pointerType.current=event.pointerType;if(event.button!==0||!event.isPrimary||excluded(event)){cancel();return;}clearTimeout(timer.current);const rect=event.currentTarget.getBoundingClientRect(),point={x:event.clientX,y:event.clientY};start.current=point;setPress({...point,rx:point.x-rect.left,ry:point.y-rect.top});timer.current=setTimeout(()=>fire(point),delay);},
  onPointerMove:(event:React.PointerEvent)=>{const origin=start.current;if(origin&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>tolerance)cancel();},
  // Touch pointers are implicitly captured by the pressed child, so only a mouse can genuinely leave the bar mid-press.
  onPointerUp:cancel,onPointerCancel:cancel,onPointerLeave:(event:React.PointerEvent)=>{if(event.pointerType==='mouse')cancel();},onDragStart:cancel,
  onTouchEnd:(event:React.TouchEvent)=>{if(fired.current&&event.cancelable)event.preventDefault();},
  onClickCapture:(event:React.MouseEvent)=>{if(!fired.current||!inside(event))return;fired.current=false;event.preventDefault();event.stopPropagation();},
  // Android raises contextmenu at its own long-press timeout (~400-500ms); a touch that already moved past the tolerance must not open the menu through it.
  onContextMenu:(event:React.MouseEvent)=>{if(!inside(event))return;event.preventDefault();if(fired.current||excluded(event)||(pointerType.current==='touch'&&!start.current))return;const rect=event.currentTarget.getBoundingClientRect(),keyboard=!event.clientX&&!event.clientY;fire(keyboard?{x:rect.left+24,y:rect.top}:{x:event.clientX,y:event.clientY});}
 }};
}
