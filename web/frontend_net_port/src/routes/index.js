import React, { Suspense, lazy } from 'react';
import { useCookies } from 'react-cookie';
import CssBaseline from '@mui/material/CssBaseline';

import Main from '../pages/Main';
import NotFound from '../pages/NotFound';
import MainLayout from '../components/MainLayout';
import Login from '../pages/Login';

import Settings from '../pages/Settings';

import {
    Route,
    Routes
} from 'react-router-dom';

const AppRoutes = (props) => {
    return (
        <Suspense fallback={<div>Загрузка...</div>}>
            <Routes>
                <Route exact path="/" element={<MainLayout><Main/></MainLayout>}/>
                <Route exact path="/settings" element={<MainLayout><Settings/></MainLayout>}/>

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
