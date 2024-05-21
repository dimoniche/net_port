import React, { createContext, useState } from 'react';

const AuthContext = createContext();

const AuthProvider = ({ children }) => {
    const [isAuthenticated, setAuthState] = useState(false);

    return (
        <AuthContext.Provider
            value={{
                setAuthState,
                isAuthenticated
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export { AuthContext, AuthProvider };
