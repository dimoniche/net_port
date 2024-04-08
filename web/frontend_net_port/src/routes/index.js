import React, { Suspense, lazy } from 'react';
import { useCookies } from 'react-cookie';

import Main from '../pages/Main';
import MainLayout from '../components/MainLayout';

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
