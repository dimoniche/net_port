import React, { Suspense, lazy } from 'react';
import { useCookies } from 'react-cookie';
import CssBaseline from '@mui/material/CssBaseline';

import Main from '../pages/Main';
import NotFound from '../pages/NotFound';
import MainLayout from '../components/MainLayout';

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
  
    return children;
  }

const AppRoutes = (props) => {
    return (
        <Suspense fallback={<div>Загрузка...</div>}>
            <Routes>
                <Route path="/" element={<Navigate to="/main" />}/>
                <Route path="/main" element={<RequireAuth><MainLayout ability={props.ability}><Main/></MainLayout></RequireAuth>}/>

                <Route path="/settings" element={<RequireAuth><MainLayout ability={props.ability}><Settings/></MainLayout></RequireAuth>}/>
                <Route path="/settings/user" element={<RequireAuth><MainLayout ability={props.ability}><UserSettingsEdit/></MainLayout></RequireAuth>}/>

                <Route path="/servers" element={<RequireAuth><MainLayout ability={props.ability}><Servers/></MainLayout></RequireAuth>}/>
                <Route path="/servers/edit/:id" element={<RequireAuth><MainLayout ability={props.ability}><ServerSettingsEdit/></MainLayout></RequireAuth>}/>
                <Route path="/servers/new" element={<RequireAuth><MainLayout ability={props.ability}><NewServerSettingsData/></MainLayout></RequireAuth>}/>

                <Route path='*' element={<CssBaseline><NotFound/></CssBaseline>}/>
            </Routes>
        </Suspense>
    )
};

const mainNavSection = [
    { title: 'Главная', href: '/main', name: 'MainTitle' },
];

const minorNavSection = [
    { title: 'Профиль', href: '/settings', name: 'Config' },
    { title: 'Серверы', href: '/servers', name: 'Config' },
];

export default AppRoutes;
export { mainNavSection, minorNavSection };
