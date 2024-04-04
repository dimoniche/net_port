import React, { Suspense, lazy } from 'react';

import Main from '../pages/Main';

import {
    Route,
    Switch,
    Redirect
} from 'react-router-dom';

//<MainLayout {...rest}>{children}</MainLayout>

const ProtectedRoute = ({ children, ...rest }) => {
    return (
        <Route
            {...rest}
            render={() =>
                {children}
            }
        ></Route>
    );
};

const AppRoutes = (props) => {
    return (
        <Suspense fallback={<div>Загрузка...</div>}>
            <Switch>
                <ProtectedRoute exact path='/'><Redirect to='/main' /></ProtectedRoute>
                <ProtectedRoute path='/main'><Main /></ProtectedRoute>
            </Switch>
        </Suspense>
    )
};

const mainNavSection = [
    { title: 'Главная', href: '/main', name: 'MainTitle' },
];

const minorNavSection = [
    { title: 'Параметры УСПД', href: '/conf', name: 'MainTitle' },
];

export default AppRoutes;
export { mainNavSection, minorNavSection };
