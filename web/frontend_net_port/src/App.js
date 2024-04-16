import React from 'react';

import { Ability } from "@casl/ability";
import { AbilityContext } from "./components/Abilities";
import { NotificationsProvider, setUpNotifications } from 'reapop';
import { ThemeProvider } from '@mui/material/styles';
import theme from './theme';
import { ErrorBoundary } from 'react-error-boundary'

import AppRoutes from './routes';
import Login from './pages/Login';
import ErrorsPage from './errors/ErrorsPage';
import Notifcations from "./notifications/Notifications";

setUpNotifications({
    defaultProps: {
        position: "bottom-right",
        dismissible: false,
    }
});

const ability = new Ability();

function ErrorFallback({ error, resetErrorBoundary }) {
    console.log("page error", error);

    /*if (error.response != undefined && error.response.status == 401) {
        return (
            <Login reloginFlag={true} resetError={resetErrorBoundary} error={error}/>
        )
    }
    else*/ if (error.response != undefined && error.response.status == 403) {
        return (
            <ErrorsPage message={"Нет прав доступа."} resetError={resetErrorBoundary} />
        )
    } else {

        if (/Loading chunk [\d]+ failed/.test(error.message)) {
            alert('Новая версия конфигуратора. Необходимо перезагрузить страницу для применения изменений.')
            window.location.reload();
            return (<></>)
        } else {
            return (
                <ErrorsPage message={error.message} resetError={resetErrorBoundary} />
            )
        }
    }
}

const App = () => {
  return (
      <AbilityContext.Provider value={ability}>
          <ThemeProvider theme={theme}>
              <NotificationsProvider>
                  <Notifcations />
                  <ErrorBoundary FallbackComponent={ErrorFallback}>
                      <AppRoutes ability={ability}/>
                  </ErrorBoundary>
              </NotificationsProvider>
          </ThemeProvider>
      </AbilityContext.Provider>
  )
};

export default App;
