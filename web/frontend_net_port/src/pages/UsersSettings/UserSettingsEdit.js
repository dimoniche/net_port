import React, { useContext, useEffect, useState, lazy } from "react";
import { useParams } from "react-router-dom";
import { useCookies } from "react-cookie";
import { ApiContext } from "../../context/ApiContext";
import { useFormik } from "formik";
import { useNavigate } from "react-router-dom";
import CommonDialog from "../../components/CommonDialog";

import Box from "@mui/material/Box";
import * as Yup from "yup";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Paper from "@mui/material/Paper";
import isEmpty from "lodash/isEmpty";
import OutlinedInput from "@mui/material/OutlinedInput";
import InputLabel from "@mui/material/InputLabel";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import FormControl from "@mui/material/FormControl";
import updateAbility from "../../config/permission";

const InputFieldWidth = { width: "100%" };

const UserSettingsEdit = ({ children, ...rest }) => {
    const { userId } = useParams();
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();
    const history = useNavigate();

    const [isSubmitting, setSubmitting] = useState(false);
    const [isChangedData, setChangedData] = useState(false);
    const [addError, setAddError] = useState(false);
    const [userData, setUserData] = useState();

    const [wrongPassword, setWrongPassword] = useState(false);

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    const [showPassword, setShowPassword] = React.useState(false);
    const [showRePassword, setShowRePassword] = React.useState(false);

    useEffect(() => {
        const abortController = new AbortController();

        async function fetchData(abortController) {
            let response_error = false;
            setChangedData(false);

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

            if (user.status === 200) {
                console.log(user.data.data[0].email);

                formik.setValues({
                    login: user.data.data[0].login,
                    username: user.data.data[0].username,
                    email: user.data.data[0].email,
                    phone: user.data.data[0].phone,
                });

                setUserData(userData);
            }
        }

        fetchData(abortController);

        return () => {
            //abortController.abort();
        };
    }, []);

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
        updateAbility(rest.ability, null);
    };

    const formHandler = async (values) => {
        var data;
        if (!isEmpty(formik.values.password)) {
            if (formik.values.password === formik.values.repassword) {
                data = {
                    login: formik.values.login,
                    password: formik.values.password,
                    username: formik.values.username,
                    email: formik.values.email,
                    phone: formik.values.phone,
                };
            } else {
                setWrongPassword(true);
                return;
            }
        } else {
            data = {
                login: formik.values.login,
                username: formik.values.username,
                email: formik.values.email,
                phone: formik.values.phone,
            };
        }

        setSubmitting(true);
        setAddError(false);

        try {
            api.put(`/users/${cookies.user.id}`, data)
                .then((response) => {
                    setSubmitting(false);
                    history(-1);
                })
                .catch((error) => {
                    console.error(error.response);
                    if (error.response.status === 422) {
                    }
                    if (error.response.status === 401) {
                        handleLogout();
                    }
                    setSubmitting(false);
                    setAddError(true);
                });
        } catch (error) {
            setError(error);
            setAddError(true);
            console.log(JSON.stringify(error.message));
        }
    };

    const formReset = async (values) => {
        history(-1);
    };

    const InitValues = {
        login: "",
        password: "",
        repassword: "",
        username: "",
        email: "",
        phone: "",
    };

    let Schema = Yup.object({
        login: Yup.string().required(),
        password: Yup.string(),
        repassword: Yup.string(),
        username: Yup.string(),
        email: Yup.string(),
        phone: Yup.string(),
    });

    const formik = useFormik({
        initialValues: InitValues,
        validationSchema: Schema,
    });

    const handleClickShowPassword = () => setShowPassword((show) => !show);
    const handleClickShowRePassword = () => setShowRePassword((show) => !show);

    return (
        <React.Fragment>
            <Paper
                sx={{
                    mt: 1,
                    mb: 1,
                    p: 2,
                    bottom: "0",
                    display: "flex",
                    flexDirection: "column",
                    width: 800,
                }}
            >
                <span>Редактирование настроек пользователя</span>
                <Box sx={{ mt: 2, flexGrow: 1 }}>
                    <Divider sx={{ mb: 2 }} />
                    <Grid container spacing={1}>
                        <Grid item xs={6}>
                            <FormControl fullWidth variant="outlined">
                                <TextField
                                    sx={InputFieldWidth}
                                    label="Логин"
                                    variant="outlined"
                                    onChange={formik.handleChange}
                                    onKeyUp={() => {
                                        setChangedData(true);
                                    }}
                                    name="login"
                                    value={formik.values.login || ""}
                                    error={
                                        formik.touched.login &&
                                        Boolean(formik.errors.login)
                                    }
                                ></TextField>
                            </FormControl>
                        </Grid>
                        <Grid item xs={6}></Grid>
                        <Grid item xs={6}>
                            <FormControl fullWidth variant="outlined">
                                <InputLabel htmlFor="outlined-adornment-password">
                                    Пароль
                                </InputLabel>
                                <OutlinedInput
                                    sx={InputFieldWidth}
                                    label="Пароль"
                                    variant="outlined"
                                    disabled={isSubmitting}
                                    onChange={formik.handleChange}
                                    onKeyUp={() => {
                                        setChangedData(true);
                                    }}
                                    name="password"
                                    value={formik.values.password || ""}
                                    error={
                                        formik.touched.password &&
                                        Boolean(formik.errors.password)
                                    }
                                    id="outlined-adornment-password"
                                    type={showPassword ? "text" : "password"}
                                    endAdornment={
                                        <InputAdornment position="end">
                                            <IconButton
                                                aria-label="toggle password visibility"
                                                onClick={
                                                    handleClickShowPassword
                                                }
                                                edge="end"
                                            >
                                                {showPassword ? (
                                                    <VisibilityOff />
                                                ) : (
                                                    <Visibility />
                                                )}
                                            </IconButton>
                                        </InputAdornment>
                                    }
                                />
                            </FormControl>
                        </Grid>
                        <Grid item xs={6}>
                            <FormControl fullWidth variant="outlined">
                                <InputLabel htmlFor="outlined-adornment-password">
                                    Повторите ввод пароля
                                </InputLabel>
                                <OutlinedInput
                                    sx={InputFieldWidth}
                                    label="Повторите ввод пароля"
                                    variant="outlined"
                                    disabled={isSubmitting}
                                    onChange={formik.handleChange}
                                    onKeyUp={() => {
                                        setChangedData(true);
                                    }}
                                    name="repassword"
                                    value={formik.values.repassword || ""}
                                    error={
                                        formik.touched.repassword &&
                                        Boolean(formik.errors.repassword)
                                    }
                                    id="outlined-adornment-password"
                                    type={showRePassword ? "text" : "password"}
                                    endAdornment={
                                        <InputAdornment position="end">
                                            <IconButton
                                                aria-label="toggle password visibility"
                                                onClick={
                                                    handleClickShowRePassword
                                                }
                                                edge="end"
                                            >
                                                {showRePassword ? (
                                                    <VisibilityOff />
                                                ) : (
                                                    <Visibility />
                                                )}
                                            </IconButton>
                                        </InputAdornment>
                                    }
                                />
                            </FormControl>
                        </Grid>
                        <Grid item xs={6}>
                            <FormControl fullWidth variant="outlined">
                                <TextField
                                    sx={InputFieldWidth}
                                    label="Имя пользователя"
                                    variant="outlined"
                                    onChange={formik.handleChange}
                                    onKeyUp={() => {
                                        setChangedData(true);
                                    }}
                                    name="username"
                                    value={formik.values.username || ""}
                                    error={
                                        formik.touched.username &&
                                        Boolean(formik.errors.username)
                                    }
                                ></TextField>
                            </FormControl>
                        </Grid>
                        <Grid item xs={6}>
                            <TextField
                                sx={InputFieldWidth}
                                label="почта"
                                variant="outlined"
                                onChange={formik.handleChange}
                                onKeyUp={() => {
                                    setChangedData(true);
                                }}
                                name="email"
                                value={formik.values.email || ""}
                                error={
                                    formik.touched.email &&
                                    Boolean(formik.errors.email)
                                }
                            ></TextField>
                        </Grid>
                        <Grid item xs={6}>
                            {addError && (
                                <Alert
                                    severity="error"
                                    variant="filled"
                                    onClose={() => {
                                        setAddError(false);
                                    }}
                                >
                                    <AlertTitle>Ошибка</AlertTitle>
                                    Ошибка при сохранении настроек пользователя
                                </Alert>
                            )}
                        </Grid>
                        <Grid item xs={6}></Grid>
                        <Grid item xs={6}>
                            <Button
                                color="primary"
                                disabled={!isChangedData}
                                size="large"
                                type="submit"
                                variant="contained"
                                onClick={formHandler}
                            >
                                Сохранить
                            </Button>
                            <> </>
                            <Button
                                size="large"
                                variant="outlined"
                                type="reset"
                                onClick={formReset}
                            >
                                Отмена
                            </Button>
                        </Grid>
                    </Grid>
                </Box>
            </Paper>
            <CommonDialog
                open={wrongPassword}
                title={"Ошибка"}
                text={"Введенные пароли не совпали."}
                handleCancel={() => setWrongPassword(false)}
                handleSubmit={() => setWrongPassword(false)}
            />
        </React.Fragment>
    );
};

export default UserSettingsEdit;
