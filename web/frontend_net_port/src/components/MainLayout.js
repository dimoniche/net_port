import React, { useState, useEffect, useContext, useCallback } from "react";
import { useTheme } from "@mui/material/styles";
import { useCookies } from "react-cookie";
import { useNavigate, useLocation } from "react-router-dom";
import { ApiContext } from "../context/ApiContext";

import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import CssBaseline from "@mui/material/CssBaseline";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import NavBlock from "./NavBlock";
import Tooltip from "@mui/material/Tooltip";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import LoginIcon from "@mui/icons-material/Login";
import Modal from "@mui/material/Modal";
import HelpCenterIcon from "@mui/icons-material/HelpCenter";

import { mainNavSection, minorNavSection } from "../routes";
import { AppBar, DrawerHeader, Main, drawerWidth } from "./MainLayout.styles";
import Login from "../pages/Login";
import NewUserSettingsData from "../pages/UsersSettings/NewUserSettingsData";

import { Can } from "./Abilities";
import updateAbility from "../config/permission";

import logo from "../assets/netport-120-120.png";

const style = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 600,
    bgcolor: "background.paper",
    border: "2px solid #000",
    boxShadow: 24,
    p: 6,
};

const styleRegister = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 900,
    bgcolor: "background.paper",
    border: "2px solid #000",
    boxShadow: 24,
    p: 6,
};

export default function PersistentDrawerLeft({ children, ...rest }) {
    const theme = useTheme();
    const [cookies, , removeCookie] = useCookies();
    const history = useNavigate();
    const location = useLocation();
    const { api } = useContext(ApiContext);

    const [open, setOpen] = React.useState(true);
    const handleDrawerOpen = () => setOpen(true);
    const handleDrawerClose = () => setOpen(false);

    const [openRight, setOpenRight] = React.useState(false);
    const handleDrawerOpenRight = () => setOpenRight(true);
    const handleDrawerCloseRight = () => setOpenRight(false);

    const [openLogin, setOpenLogin] = React.useState(false);
    const [openRegister, setOpenRegister] = React.useState(false);

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
        updateAbility(rest.ability, null);
    };

    const handleLogin = () => {
        setOpenLogin(true);
    };

    const handleCloseLogin = () => {
        setOpenLogin(false);
    };

    const handleRegister = () => {
        setOpenLogin(false);
        setOpenRegister(true);
    };

    const handleCloseRegister = () => {
        setOpenRegister(false);
        setOpenLogin(true);
    };

    useEffect(() => {
        if (rest.ability !== undefined) {
            updateAbility(rest.ability, cookies.user);
        }
    }, []);

    return (
        <React.Fragment>
            <Box sx={{ display: "flex" }}>
                <CssBaseline />
                <Box sc={{ flexGrow: 1 }}>
                    <AppBar position="fixed" open={open} openRight={openRight}>
                        <Toolbar>
                            <IconButton
                                color="inherit"
                                aria-label="open drawer"
                                onClick={handleDrawerOpen}
                                edge="start"
                                sx={{ mr: 2, ...(open && { display: "none" }) }}
                            >
                                <MenuIcon />
                            </IconButton>
                            <Typography
                                variant="h6"
                                noWrap
                                component="div"
                                sx={{ flexGrow: 1 }}
                            >
                                NET PORT
                            </Typography>
                            <Tooltip title="Текущий пользователь">
                                <Typography>
                                    {cookies.user !== undefined
                                        ? cookies.user.login
                                        : ""}
                                </Typography>
                            </Tooltip>
                            {cookies.user !== undefined ? (
                                <Tooltip title="Выход">
                                    <IconButton
                                        color="inherit"
                                        onClick={handleLogout}
                                    >
                                        <ExitToAppIcon />
                                    </IconButton>
                                </Tooltip>
                            ) : (
                                <Tooltip title="Вход">
                                    <IconButton
                                        color="inherit"
                                        onClick={handleLogin}
                                    >
                                        <LoginIcon />
                                    </IconButton>
                                </Tooltip>
                            )}
                            {location.pathname !== "/main" ? (
                                <Tooltip title="Помощь">
                                    <IconButton
                                        color="inherit"
                                        aria-label="open drawer"
                                        onClick={handleDrawerOpenRight}
                                        edge="start"
                                        sx={{
                                            mr: 2,
                                            ...(openRight && {
                                                display: "none",
                                            }),
                                        }}
                                    >
                                        <HelpCenterIcon />
                                    </IconButton>
                                </Tooltip>
                            ) : (
                                <></>
                            )}
                        </Toolbar>
                    </AppBar>
                </Box>
                <Drawer
                    sx={{
                        width: drawerWidth,
                        flexShrink: 0,
                        "& .MuiDrawer-paper": {
                            width: drawerWidth,
                            boxSizing: "border-box",
                        },
                    }}
                    variant="persistent"
                    anchor="left"
                    open={open}
                >
                    <DrawerHeader>
                        {false ? (
                            <img
                                src={logo}
                                alt="net port"
                                style={{ height: "48px" }}
                            />
                        ) : (
                            <></>
                        )}
                        <IconButton onClick={handleDrawerClose}>
                            {theme.direction === "ltr" ? (
                                <ChevronLeftIcon />
                            ) : (
                                <ChevronRightIcon />
                            )}
                        </IconButton>
                    </DrawerHeader>
                    <Divider />
                    <NavBlock navData={mainNavSection} ability={rest.ability} />
                    <Can I="read" a="Config" passThrough>
                        {(allowed) =>
                            allowed ? (
                                <>
                                    <Divider />
                                    <NavBlock navData={minorNavSection} />
                                </>
                            ) : (
                                <></>
                            )
                        }
                    </Can>
                    <Divider />
                </Drawer>
                {location.pathname !== "/main" ? (
                    <Drawer
                        sx={{
                            flexShrink: 0,
                            "& .MuiDrawer-paper": {
                                width: drawerWidth,
                                boxSizing: "border-box",
                            },
                        }}
                        variant="persistent"
                        anchor="right"
                        open={openRight}
                    >
                        <Divider />
                        <DrawerHeader>
                            <IconButton onClick={handleDrawerCloseRight}>
                                {theme.direction === "rtl" ? (
                                    <ChevronLeftIcon />
                                ) : (
                                    <ChevronRightIcon />
                                )}
                            </IconButton>
                        </DrawerHeader>
                        <Divider />
                        {location.pathname === "/main" ? (
                            <></>
                        ) : location.pathname === "/settings" ? (
                            <>
                                <b>Настройки пользователя.</b>
                                <br />
                                Настраиваются параметры доступа к сервису,
                                <br />
                                логин и пароль.
                            </>
                        ) : location.pathname === "/servers" ? (
                            <>
                                <b>Настройки серверов</b>
                                <br />
                                Возможно добавить новый сервер доступа с помощью
                                кнопки <b>"Добавить"</b>.
                                <br />
                                Кнопкой <b>"Перезагрузить"</b> осуществляется
                                перезапуск всех запущенных и пользователя
                                сервисов доступа к удаленным устройствам.
                                <br />
                                <br />
                                Настройки каждого сервера включают в себя
                                возможность выключить ожидание подключения
                                пользователей и устройств. <b>Входящий порт</b>
                                это порт подключения пользователя из вне к
                                сервису.
                                <b>Перенаправляемый порт</b> это порт к которому
                                подключается установленный на внешнем устройстве
                                клиент для поддержания постоянного соединения.
                            </>
                        ) : (
                            <></>
                        )}
                    </Drawer>
                ) : (
                    <></>
                )}
                <Main open={open} openRight={openRight}>
                    <DrawerHeader />
                    {children}
                    <DrawerHeader />
                </Main>
            </Box>
            <Modal
                aria-labelledby="unstyled-modal-title"
                aria-describedby="unstyled-modal-description"
                align-items="center"
                justify-content="center"
                open={openLogin}
                onClose={handleCloseLogin}
            >
                <Box sx={style}>
                    <Login register={handleRegister} ability={rest.ability} />
                </Box>
            </Modal>
            <Modal
                aria-labelledby="unstyled-modal-title"
                aria-describedby="unstyled-modal-description"
                align-items="center"
                justify-content="center"
                open={openRegister}
                onClose={handleCloseRegister}
            >
                <Box sx={styleRegister}>
                    <NewUserSettingsData
                        ability={rest.ability}
                        closeHandle={handleCloseRegister}
                    />
                </Box>
            </Modal>
        </React.Fragment>
    );
}
