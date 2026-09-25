import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './index.css';
import { initializeTelegram } from './telegram/runtime.js';

const root = ReactDOM.createRoot(document.getElementById('root')!);
initializeTelegram().then(() => root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)).catch(error => root.render(<main style={{padding:32,fontFamily:'sans-serif'}}><h1>Осколок</h1><p>{error.message}</p><button onClick={() => location.reload()}>Попробовать снова</button></main>));
