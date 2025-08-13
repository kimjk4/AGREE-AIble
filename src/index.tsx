import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import AgreeIIWorkflow from './App'; // Assuming your main file is named App.tsx

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <AgreeIIWorkflow />
  </React.StrictMode>
);
