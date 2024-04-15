import React, { Suspense, lazy } from 'react';
import { useCookies } from 'react-cookie';
import CssBaseline from '@mui/material/CssBaseline';
import isEmpty from 'lodash/isEmpty';

import Main from '../pages/Main';
import NotFound from '../pages/NotFound';
import MainLayout from '../components/MainLayout';
import Login from '../pages/Login';

import Settings from '../pages/Settings';
import UserSettingsEdit from '../pages/UsersSettings/UserSettingsEdit';
import ServerSettingsEdit from '../pages/ServerSettings/ServerSettingsEdit';
import NewServerSettingsData from '../pages/ServerSettings/NewServerSettingsData';
import Servers from '../pages/Servers';

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
                <Route path="/settings/user" element={<RequireAuth><MainLayout><UserSettingsEdit/></MainLayout></RequireAuth>}/>

                <Route path="/servers" element={<RequireAuth><MainLayout><Servers/></MainLayout></RequireAuth>}/>
                <Route path="/servers/edit/:id" element={<RequireAuth><MainLayout><ServerSettingsEdit/></MainLayout></RequireAuth>}/>
                <Route path="/servers/new" element={<RequireAuth><MainLayout><NewServerSettingsData/></MainLayout></RequireAuth>}/>

                <Route path='/login' element={<CssBaseline><Login/></CssBaseline>}/>
                <Route path='*' element={<CssBaseline><NotFound/></CssBaseline>}/>
            </Routes>
        </Suspense>
    )
};

const mainNavSection = [
    { title: 'Главная', href: '/main', name: 'MainTitle' },
];

const minorNavSection = [
    { title: 'Профиль', href: '/settings', name: 'MainTitle' },
    { title: 'Серверы', href: '/servers', name: 'MainTitle' },
    { title: 'Статистика', href: '/statistic', name: 'MainTitle' },
];

export default AppRoutes;
export { mainNavSection, minorNavSection };
