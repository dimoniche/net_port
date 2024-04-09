import React, { Suspense, lazy } from 'react';
import { useCookies } from 'react-cookie';
import CssBaseline from '@mui/material/CssBaseline';
import isEmpty from 'lodash/isEmpty';

import Main from '../pages/Main';
import NotFound from '../pages/NotFound';
import MainLayout from '../components/MainLayout';
import Login from '../pages/Login';

import Settings from '../pages/Settings';

import {
    Route,
    Routes,
    Navigate
} from 'react-router-dom';

function RequireAuth({ children }) {
    const [cookies] = useCookies();
  
    if (isEmpty(cookies.token)) {
      return <Navigate to="/login" />;
    }
  
    return children;
  }

const AppRoutes = (props) => {
    return (
        <Suspense fallback={<div>Загрузка...</div>}>
            <Routes>
                <Route path="/" element={<Navigate to="/main" />}/>
                <Route path="/main" element={<RequireAuth><MainLayout><Main/></MainLayout></RequireAuth>}/>
                <Route path="/settings" element={<RequireAuth><MainLayout><Settings/></MainLayout></RequireAuth>}/>

                <Route path='/login' element={<CssBaseline><Login/></CssBaseline>}/>
                <Route path='*' element={<CssBaseline><NotFound/></CssBaseline>}/>
            </Routes>
        </Suspense>
    )
};

const mainNavSection = [
    { title: 'Главная', href: '/', name: 'MainTitle' },
];

const minorNavSection = [
    { title: 'Параметры', href: '/settings', name: 'MainTitle' },
];

export default AppRoutes;
export { mainNavSection, minorNavSection };
