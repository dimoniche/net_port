/* eslint-disable eqeqeq */
import React, { useState, useContext, useEffect }  from 'react';
import { useCookies } from 'react-cookie';
import { useNavigate } from 'react-router-dom';

import isEmpty from 'lodash/isEmpty';

import { UserSettingsData } from './UsersSettings/UserSettingsData';
import { ApiContext } from '../context/ApiContext';
import { Loader } from '../components/Loader';

const Settings = () => {
    const { api } = useContext(ApiContext);
    const [cookies] = useCookies();
    const history = useNavigate();

    const [userSettings, setUserSettings] = useState(null);

    const editRSSettingHandler = () => history(`/settings/user`);

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    useEffect(() => {
        const abortController = new AbortController();
        async function fetchData(abortController) {
            let response_error = false;

            if(isEmpty(cookies.user)) {
                history('/main')
                return;
            }

            const user = await api
                .get(`/users?login=${cookies.user.login}`, {
                    signal: abortController.signal
                })
                .catch((err) => {
                    response_error = true;
                    setError(err);
                });

            if (response_error) return;
            if (abortController.signal.aborted) return;

            if (user.status == 200) {
                setUserSettings(user.data.data[0]);
            }
        }

        fetchData(abortController);

        return () => {
            //abortController.abort();
        }
    }, []);

    return ( 
        !isEmpty(userSettings) ?
        <>
        <UserSettingsData key='usersettings' data={userSettings} editHandler={() => {
            editRSSettingHandler();
        }} />
        </> : <Loader title={'Данные загружаются'}/>
    )
};

export default Settings;
