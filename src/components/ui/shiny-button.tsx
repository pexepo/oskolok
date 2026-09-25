import type {ButtonHTMLAttributes,ReactNode} from 'react';

interface ShinyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>{
  children:ReactNode;
}

/** Vite-friendly version of the supplied shiny CTA; styles live in index.css. */
export function ShinyButton({children,className='',type='button',...props}:ShinyButtonProps){
  return <button type={type} className={`shiny-cta ${className}`} {...props}><span className="shiny-cta-content">{children}</span></button>;
}
