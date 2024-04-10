import React, { createContext } from 'react';
import { useCookies } from 'react-cookie';
import axios from 'axios';
import { API_BASE_URL, API_TIMEOUT } from '../consts';

const ApiContext = createContext();

const ApiProvider = ({ children }) => {
    const [cookies] = useCookies();

    const api = axios.create({
        baseURL: API_BASE_URL,
        timeout: API_TIMEOUT
    });

    api.defaults.headers.common['Authorization'] = `Bearer ${cookies.token}`;

    return (
        <ApiContext.Provider
            value={{
                api
            }}
        >
            {children}
        </ApiContext.Provider>
    )
}

export { ApiContext, ApiProvider };
