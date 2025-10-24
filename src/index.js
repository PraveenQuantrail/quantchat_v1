import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import SessionIDProvider from './context/SessionIDContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <SessionIDProvider>
        <App />
    </SessionIDProvider>
);