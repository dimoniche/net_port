/* eslint-disable eqeqeq */
import React, { useState, useContext, useEffect } from "react";
import { useCookies } from "react-cookie";
import { useNavigate } from "react-router-dom";

import isEmpty from "lodash/isEmpty";

import { UserSettingsData } from "./UsersSettings/UserSettingsData";
import ServerDisplaySettings from "./ServerSettings/ServerDisplaySettings";
import { ApiContext } from "../context/ApiContext";
import { Loader } from "../components/Loader";
import Main from "./Main";
import updateAbility from "../config/permission";

import Paper from "@mui/material/Paper";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";

const Settings = ({ children, ...rest }) => {
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();
    const history = useNavigate();

    const [userSettings, setUserSettings] = useState(null);
    const [activeTab, setActiveTab] = useState(0);

    const editRSSettingHandler = () => history(`/settings/user`);

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
        updateAbility(rest.ability, null);
    };

    const handleTabChange = (event, newValue) => {
        setActiveTab(newValue);
    };

    useEffect(() => {
        const abortController = new AbortController();
        async function fetchData(abortController) {
            let response_error = false;

            if (isEmpty(cookies.user)) {
                history("/main");
                return;
            }

            const user = await api
                .get(`/users?login=${cookies.user.login}`, {
                    signal: abortController.signal,
                })
                .catch((err) => {
                    if (err.response.status === 401) {
                        handleLogout();
                    } else {
                        setError(err);
                    }
                    response_error = true;
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
        };
    }, []);

    return !isEmpty(cookies.user) ? (
        !isEmpty(userSettings) ? (
            <>
                <Box sx={{ width: '100%' }}>
                    <Paper square>
                        <Tabs
                            value={activeTab}
                            onChange={handleTabChange}
                            aria-label="settings tabs"
                            centered
                        >
                            <Tab label="Пользователь" />
                            <Tab label="Отображение серверов" />
                        </Tabs>
                    </Paper>
                    {activeTab === 0 && (
                        <UserSettingsData
                            key="usersettings"
                            data={userSettings}
                            editHandler={() => {
                                editRSSettingHandler();
                            }}
                        />
                    )}
                    {activeTab === 1 && (
                        <ServerDisplaySettings ability={rest.ability} />
                    )}
                </Box>
            </>
        ) : (
            <Loader title={"Данные загружаются"} />
        )
    ) : (
        <Main></Main>
    );
};

export default Settings;
