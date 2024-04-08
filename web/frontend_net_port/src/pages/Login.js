/* eslint-disable eqeqeq */
import React, { useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { useCookies } from 'react-cookie';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext'; // FIX: change authCtx usage
import { API_BASE_URL, API_TIMEOUT, AUTH_STRATEGY } from '../consts';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import * as yup from 'yup';
import { useFormik } from 'formik';
import Container from '@mui/material/Container';
import TextField from '@mui/material/TextField';
import OutlinedInput from '@mui/material/OutlinedInput';
import InputLabel from '@mui/material/InputLabel';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import FormControl from '@mui/material/FormControl';

//import updateAbility from "../config/permission";

const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: API_TIMEOUT
});

const validationSchema = yup.object({
    login: yup
        .string('Введите логин')
        .required('Логин не указан'),
    password: yup
        .string('Введите пароль')
        .required('Пароль не указан'),
});

//TODO: Fix 'Can't perform a React state update on an unmounted component.'
const Login = (props) => {
    const [cookie, setCookie, removeCookie] = useCookies();
    const history = useNavigate();
    const authCtx = useContext(AuthContext); // FIX: change authCtx usage
    const [authError, setAuthError] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);

    const [relogin,] = useState(props.reloginFlag);

    const [showPassword, setShowPassword] = React.useState(false);

    const handleClickShowPassword = () => setShowPassword((show) => !show);

    useEffect(() => {
        removeCookie('token');
        removeCookie('user');
        authCtx.setAuthState(false);
    }, []);

    const authHandler = async (values) => {
        const { login, password } = values;
        setSubmitting(true);
        try {
            const { data } = await api.post('/authentication', {
                strategy: AUTH_STRATEGY,
                login,
                password
            });

            const { accessToken, user } = data;
            setCookie('token', accessToken);
            setCookie('user', user);

            setSubmitting(false);
            setAuthError(false);
            authCtx.setAuthState(true); // FIX: change authCtx usage

            //updateAbility(props.ability, user);

            if (props.resetError != undefined) props.resetError();
            history.push('/main');
        } catch (error) {
            console.log(JSON.stringify(error.message)); // TODO: Add winston or other logger solution

            setSubmitting(false);
            setAuthError(true);
        }
    }

    const formik = useFormik({
        initialValues: {
            login: '',
            password: '',
        },
        validationSchema: validationSchema,
        onSubmit: authHandler
    });

    return (
        <Box
            sx={{
                backgroundColor: 'background.default',
                left: '0',
                bottom: '0',
                position: 'absolute',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                justifyContent: 'center',
            }}
        >
            <Container maxWidth="sm" autoFocus={true}>
                <form onSubmit={formik.handleSubmit}>
                    <TextField
                        inputProps={{
                            autocomplete: 'new-password',
                            form: {
                                autocomplete: 'off',
                            },
                        }}
                        autoFocus={true}
                        disabled={isSubmitting}
                        error={formik.touched.login && Boolean(formik.errors.login)}
                        fullWidth
                        label="Логин"
                        margin="normal"
                        name="login"
                        onChange={formik.handleChange}
                        type="text"
                        value={formik.values.login}
                        variant="outlined"
                    />
                    <FormControl fullWidth variant="outlined">
                        <InputLabel htmlFor="outlined-adornment-password">Пароль</InputLabel>
                        <OutlinedInput
                            fullWidth
                            label="Пароль"
                            variant="outlined"
                            disabled={isSubmitting}
                            onChange={formik.handleChange}
                            name="password"
                            value={formik.values.password}
                            error={formik.touched.password && Boolean(formik.errors.password)}
                            id="outlined-adornment-password"
                            type={showPassword ? 'text' : 'password'}

                            endAdornment={
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="toggle password visibility"
                                        onClick={handleClickShowPassword}
                                        edge="end"
                                    >
                                        {showPassword ? <VisibilityOff /> : <Visibility />}
                                    </IconButton>
                                </InputAdornment>
                            }
                        />
                    </FormControl>
                    <Box sx={{ py: 2 }}>
                        <Button
                            color="primary"
                            disabled={isSubmitting}
                            fullWidth
                            size="large"
                            type="submit"
                            variant="contained"
                        >
                            Вход
                        </Button>
                    </Box>
                    {authError && <Alert
                        severity="error"
                        variant="filled"
                        onClose={() => {
                            setAuthError(false);
                            formik.resetForm({});
                        }}
                    >
                        <AlertTitle>Ошибка</AlertTitle>
                        Проверьте пароль и/или логин
                    </Alert>}
                    {relogin && <Alert
                        severity="info"
                        variant="filled"
                    >
                        <AlertTitle>Внимание!</AlertTitle>
                        Время сессии истекло. Пожалуйста, войдите заново.
                    </Alert>}
                </form>
            </Container>
        </Box>
    )
};

export default Login;
