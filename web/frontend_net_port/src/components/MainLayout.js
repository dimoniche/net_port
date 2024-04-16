import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useTheme } from '@mui/material/styles';
import { useCookies } from 'react-cookie';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import CssBaseline from '@mui/material/CssBaseline';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import NavBlock from './NavBlock';
import Switch from '@mui/material/Switch';
import Stack from '@mui/material/Stack';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import isEmpty from 'lodash/isEmpty';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import LoginIcon from '@mui/icons-material/Login';
import Modal from '@mui/material/Modal';

import { mainNavSection, minorNavSection } from "../routes";
import { AppBar, DrawerHeader, Main, drawerWidth } from './MainLayout.styles';
import Login from "../pages/Login";
import NewUserSettingsData from "../pages/UsersSettings/NewUserSettingsData";

const style = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 600,
    bgcolor: 'background.paper',
    border: '2px solid #000',
    boxShadow: 24,
    p: 6,
};

const styleRegister = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 900,
    bgcolor: 'background.paper',
    border: '2px solid #000',
    boxShadow: 24,
    p: 6,
};

export default function PersistentDrawerLeft({ children, ...rest }) {
    const theme = useTheme();
    const [cookies, , removeCookie] = useCookies();
    const history = useNavigate();

    const [open, setOpen] = React.useState(true);
    const handleDrawerOpen = () => setOpen(true);
    const handleDrawerClose = () => setOpen(false);

    const [openLogin, setOpenLogin] = React.useState(false);
    const [openRegister, setOpenRegister] = React.useState(false);

    const handleLogout = () => {
        removeCookie('token');
        removeCookie('user');
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

    return (
        <React.Fragment>
            <Box sx={{ display: 'flex' }}>
                <CssBaseline />
                <Box sc={{ flexGrow: 1 }}>
                    <AppBar position="fixed" open={open}>
                        <Toolbar>
                            <IconButton
                                color="inherit"
                                aria-label="open drawer"
                                onClick={handleDrawerOpen}
                                edge="start"
                                sx={{ mr: 2, ...(open && { display: 'none' }) }}
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
                                    {cookies.user != undefined ? cookies.user.login : ''}
                                </Typography>
                            </Tooltip>
                            {
                                cookies.user != undefined ?
                            <Tooltip title="Выход">
                                <IconButton
                                    color="inherit"
                                    onClick={handleLogout}
                                >
                                    <ExitToAppIcon />
                                </IconButton>
                            </Tooltip> : 
                            <Tooltip title="Вход">
                            <IconButton
                                color="inherit"
                                onClick={handleLogin}
                            >
                                <LoginIcon />
                            </IconButton>
                            </Tooltip>                            
                            }
                        </Toolbar>
                    </AppBar>
                </Box>
                <Drawer
                    sx={{
                        width: drawerWidth,
                        flexShrink: 0,
                        '& .MuiDrawer-paper': {
                            width: drawerWidth,
                            boxSizing: 'border-box',
                        },
                    }}
                    variant="persistent"
                    anchor="left"
                    open={open}
                >
                    <DrawerHeader>
                        <IconButton onClick={handleDrawerClose}>
                            {theme.direction == 'ltr' ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                        </IconButton>
                    </DrawerHeader>
                    <Divider />
                    <NavBlock navData={mainNavSection} />
                    <Divider />
                        <NavBlock navData={minorNavSection} />
                    <Divider />
                </Drawer>
                <Main open={open}>
                    <DrawerHeader />
                    {children}
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
                <Box sx={style}><Login register={handleRegister}/></Box>
            </Modal>
            <Modal
                aria-labelledby="unstyled-modal-title"
                aria-describedby="unstyled-modal-description"
                align-items="center"
                justify-content="center"
                open={openRegister}
                onClose={handleCloseRegister}
            >
                <Box sx={styleRegister}><NewUserSettingsData closeHandle={handleCloseRegister}/></Box>
            </Modal>
        </React.Fragment>
    );
}
