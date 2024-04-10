import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ApiProvider } from './context/ApiContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
      <ApiProvider>
          <App />
      </ApiProvider>
      </AuthProvider>
    </Router>
  </React.StrictMode>
);
